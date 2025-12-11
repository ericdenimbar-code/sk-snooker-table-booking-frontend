'use server';

import { db } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';
import { getUserByEmail } from '@/app/admin/users/actions';
import { deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import type { Reservation } from '@/types';
import qrcode from 'qrcode';
import { sendQrCodeEmail } from '@/lib/email';
import { getRoomSettings } from '@/app/admin/settings/actions';
import admin from 'firebase-admin';

type ServerActionResponse = {
    success: boolean;
    error?: string;
};

// This function is now the single source of truth for cancelling a reservation.
export async function cancelReservation(
    reservation: Reservation,
    refund: boolean = true
): Promise<ServerActionResponse> {
    if (!db) {
        return { success: false, error: '後端資料庫未連接。' };
    }

    try {
        const user = await getUserByEmail(reservation.userEmail);
        
        let amountToRefund = 0;
        if (refund && user) {
             if (reservation.paymentMethod === 'mixed' && reservation.amountPaidWithTokens) {
                amountToRefund = reservation.amountPaidWithTokens;
            } else if (reservation.paymentMethod === 'tokens') {
                amountToRefund = reservation.costInTokens;
            }
        }
        
        // Use a transaction to ensure atomicity
        await db.runTransaction(async (transaction) => {
            const reservationRef = db.collection('reservations').doc(reservation.id);
            transaction.update(reservationRef, { status: 'Cancelled' });

            if (amountToRefund > 0 && user) {
                const userRef = db.collection('users').doc(user.id);
                // Use atomic increment for safer token refunds
                transaction.update(userRef, { tokens: admin.firestore.FieldValue.increment(amountToRefund) });
            }
        });
        
        // After the transaction is successful, delete the calendar event
        await deleteGoogleCalendarEvent(reservation);

        // Revalidate paths to update caches
        revalidatePath('/admin/bookings');
        revalidatePath('/reservations');

        return { success: true };

    } catch (e: any) {
        console.error(`Failed to cancel reservation ${reservation.id}:`, e);
        return { success: false, error: `更新預訂狀態或退款時發生錯誤: ${e.message}` };
    }
}


export async function resendConfirmationEmail(qrSecret: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    
    try {
        const reservationsRef = db.collection('reservations');
        const query = reservationsRef.where('qrSecret', '==', qrSecret).limit(1);
        const snapshot = await query.get();

        if (snapshot.empty) {
            throw new Error('找不到與此 QR Code 相關的預訂記錄。');
        }

        const reservation = snapshot.docs[0].data() as Reservation;

        const settings = await getRoomSettings('1');
        if (!settings) {
             return { success: false, error: '無法載入網站設定，無法寄送郵件。' };
        }

        if (!reservation.qrSecret || reservation.qrSecret.startsWith('USED_')) {
            return { success: false, error: '此預訂記錄缺少 QR Code 資訊或已被使用，無法重新發送。' };
        }

        const qrCodeDataUrl = await qrcode.toDataURL(reservation.qrSecret);
        const emailSent = await sendQrCodeEmail(reservation, qrCodeDataUrl, settings.contactInfo);
        if (!emailSent) {
            throw new Error('電子郵件伺服器未能成功發送郵件。');
        }

        return { success: true };

    } catch (e: any) {
        console.error(`Error resending email for QR secret ${qrSecret}:`, e);
        return { success: false, error: e.message || '發生未知錯誤。' };
    }
}
