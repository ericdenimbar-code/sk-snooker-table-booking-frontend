
'use server';

import { db } from '@/lib/firebase-admin';
import type { Reservation, TemporaryAccess } from '@/types';
import { revalidatePath } from 'next/cache';
import { createGoogleCalendarEvent } from '@/lib/google-calendar';
import { parseISO, add, sub, addDays, format, subDays } from 'date-fns';
import { randomBytes } from 'crypto';
import qrcode from 'qrcode';
import { sendQrCodeEmail } from '@/lib/email';
import { createTokenPurchaseRequest } from '@/app/admin/token-requests/actions';
import { getRoomSettings, getHASettings, type RoomSettings } from '@/app/admin/settings/actions';
import { unstable_cache as cache } from 'next/cache';
import admin from 'firebase-admin';

type ServerActionResponse = {
    success: boolean;
    error?: string;
    [key: string]: any;
};

// --- Get all reservations from Firestore (for Admin pages) ---
export async function getAllReservations(userEmail?: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db.collection('reservations');
        
        if (userEmail) {
            query = query.where('userEmail', '==', userEmail);
        }

        const snapshot = await query.get();
        const reservations = snapshot.docs.map(doc => doc.data() as Reservation);
        
        reservations.sort((a, b) => new Date(b.bookingDate).getTime() - new Date(a.bookingDate).getTime());

        return { success: true, reservations };
    } catch (e: any) {
        return { success: false, error: `從資料庫讀取預訂時發生錯誤: ${e.message}` };
    }
}


// --- Get all temporary access codes (for Admin calendar) ---
export async function getAllTemporaryAccess(): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        const snapshot = await db.collection('temporaryAccess').get();
        const accessCodes = snapshot.docs.map(doc => doc.data() as TemporaryAccess);
        return { success: true, accessCodes };
    } catch (e: any) {
        return { success: false, error: `讀取臨時進出碼時發生錯誤: ${e.message}` };
    }
}


// --- Get reservations for a specific date range from Firestore ---
export async function getReservationsForDateRange(selectedDate: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        const date = new Date(selectedDate);
        const dateStr = format(date, 'yyyy-MM-dd');
        const prevDateStr = format(subDays(date, 1), 'yyyy-MM-dd');

        const snapshot = await db.collection('reservations')
            .where('date', 'in', [dateStr, prevDateStr])
            .get();
            
        const reservations = snapshot.docs.map(doc => doc.data() as Reservation);
        return { success: true, reservations };
    } catch (e: any) {
        console.error(`Error reading reservations from database: ${e.message}`);
        return { success: false, error: `從資料庫讀取預訂時發生錯誤: ${e.message}` };
    }
}


// --- Create a new reservation in Firestore, Google Calendar, and send QR Code email ---
export async function createReservation(
    data: Omit<Reservation, 'id' | 'bookingDate' | 'qrSecret'>
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    if (data.roomId !== '1' && data.roomId !== '2') {
        return { success: false, error: '無效的房間 ID。' };
    }

    const refNumber = `RR-${Date.now().toString().slice(-6)}`;
    const qrSecret = `qs${randomBytes(12).toString('hex')}`;

    const newReservation: Reservation = {
        ...data,
        id: refNumber,
        bookingDate: new Date().toISOString(),
        qrSecret: qrSecret,
    };

    try {
        await db.collection('reservations').doc(refNumber).set(newReservation);
    } catch (dbError: any) {
        console.error(`Error writing reservation ${refNumber} to Firestore:`, dbError);
        return { success: false, error: `資料庫寫入失敗: ${dbError.message}` };
    }

    // --- Post-DB Write Operations ---
    // These should not block the main success response.
    // Errors will be logged server-side.
    
    // 1. Trigger Google Calendar and HA Webhook immediately
    try {
        const calendarSuccess = await createGoogleCalendarEvent(newReservation);
        if (calendarSuccess) {
            const haSettings = await getHASettings();
            if (haSettings.url && haSettings.webhookId) {
                fetch(`${haSettings.url}/api/webhook/${haSettings.webhookId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: 'new_booking',
                        reservationId: newReservation.id,
                        room: newReservation.roomName,
                    }),
                }).catch(e => console.error("Failed to trigger HA webhook:", e));
            }
        } else {
             console.error(`[CRITICAL] Reservation ${refNumber} created, but failed to create Google Calendar event.`);
        }
    } catch (e: any) {
        console.error(`[CRITICAL] Reservation ${refNumber} created, but an error occurred during calendar/HA processing:`, e);
    }

    // 2. Send confirmation email
    (async () => {
        try {
            const settings = await getRoomSettings('1');
            if (!settings) {
                console.error(`[CRITICAL] Cannot send email for reservation ${refNumber}: Failed to fetch settings.`);
                return;
            }
            const qrCodeDataUrl = await qrcode.toDataURL(qrSecret);
            const emailSent = await sendQrCodeEmail(newReservation, qrCodeDataUrl, settings.contactInfo);
            if (!emailSent) {
                console.error(`[CRITICAL] Reservation ${refNumber} created, but failed to send confirmation email to ${newReservation.userEmail}.`);
            }
        } catch (err) {
            console.error(`[CRITICAL] Reservation ${refNumber} created, but an error occurred during email sending process:`, err);
        }
    })();


    revalidatePath('/new-reservation', 'page');
    revalidatePath('/admin/bookings', 'page');
    
    // Return success as soon as DB write is confirmed.
    return { success: true, newReservation };
}


// --- Create MULTIPLE reservations in a single transaction ---
export async function createMultipleReservations(
    reservationsData: Omit<Reservation, 'id' | 'bookingDate' | 'qrSecret'>[],
    userId: string,
    totalCost: number
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    
    const userRef = db.collection('users').doc(userId);
    const reservationsRef = db.collection('reservations');

    const createdReservations: Reservation[] = [];

    try {
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists || (userDoc.data()?.tokens ?? 0) < totalCost) {
                throw new Error('餘額不足或找不到使用者。');
            }

            for (const resData of reservationsData) {
                const potentialConflictsQuery = reservationsRef
                    .where('roomId', '==', resData.roomId)
                    .where('date', '==', resData.date);
                
                const snapshot = await transaction.get(potentialConflictsQuery);

                const conflictingBooking = snapshot.docs.find(doc => {
                    const booking = doc.data() as Reservation;
                    return booking.status !== 'Cancelled' && 
                           booking.startTime < resData.endTime && 
                           booking.endTime > resData.startTime;
                });
                
                if (conflictingBooking) {
                    throw new Error(`時段 ${resData.roomName.replace('房間', '枱號')} ${resData.date} ${resData.startTime}-${resData.endTime} 已被預訂，請重新選擇。`);
                }
            }
            
            transaction.update(userRef, { tokens: admin.firestore.FieldValue.increment(-totalCost) });
            
            for (const resData of reservationsData) {
                const refNumber = `RR-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5)}`;
                const qrSecret = `qs${randomBytes(12).toString('hex')}`;
                
                const newReservation: Reservation = {
                    ...resData,
                    id: refNumber,
                    bookingDate: new Date().toISOString(),
                    qrSecret: qrSecret,
                };
                
                const newDocRef = reservationsRef.doc(refNumber);
                transaction.set(newDocRef, newReservation);
                createdReservations.push(newReservation);
            }
        });
        
    } catch (e: any) {
        console.error("Error in createMultipleReservations transaction:", e);
        return { success: false, error: e.message };
    }

    // --- Post-transaction side effects ---
    (async () => {
        try {
            const [settings, haSettings] = await Promise.all([getRoomSettings('1'), getHASettings()]);

            for (const newReservation of createdReservations) {
                const calendarSuccess = await createGoogleCalendarEvent(newReservation);
                 if (calendarSuccess) {
                    if (haSettings.url && haSettings.webhookId) {
                         fetch(`${haSettings.url}/api/webhook/${haSettings.webhookId}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'new_booking_batch', count: createdReservations.length }),
                        }).catch(e => console.error("Failed to trigger HA webhook for batch booking:", e));
                    }
                } else {
                    console.error(`[CRITICAL] Reservation ${newReservation.id} created, but failed to create Google Calendar event.`);
                }

                if (settings) {
                    try {
                        const qrCodeDataUrl = await qrcode.toDataURL(newReservation.qrSecret);
                        await sendQrCodeEmail(newReservation, qrCodeDataUrl, settings.contactInfo);
                    } catch (err) {
                        console.error(`[CRITICAL] Reservation ${newReservation.id} created, but email failed:`, err);
                    }
                }
            }
        } catch (postError) {
             console.error(`[CRITICAL] Post-transaction operations failed for batch booking:`, postError);
        }
    })();

    revalidatePath('/new-reservation', 'page');
    revalidatePath('/admin/bookings', 'page');
    revalidatePath('/cart', 'page');
    revalidatePath('/reservations', 'page');

    return { success: true, createdReservations };
}
