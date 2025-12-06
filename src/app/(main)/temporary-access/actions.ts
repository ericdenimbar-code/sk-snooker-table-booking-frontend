
'use server';

import { randomBytes } from 'crypto';
import qrcode from 'qrcode';
import { parseISO, add, format, isAfter } from 'date-fns';
import { createGoogleCalendarEvent, deleteGoogleCalendarEvent } from '@/lib/google-calendar';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/firebase-admin';
import type { TemporaryAccess } from '@/types';

type ServerActionResponse = {
    success: boolean;
    error?: string;
    qrCodeUrl?: string;
    newCode?: TemporaryAccess;
    activeCode?: TemporaryAccess | null;
};

// This data type now accepts an optional endTime
type CreateCodeData = {
    userId: string;
    userEmail: string;
    date: string; // 'yyyy-MM-dd'
    startTime: string; // 'HH:mm'
    endTime?: string; // 'HH:mm', optional
};

const TEMP_ACCESS_COLLECTION = 'temporaryAccess';

// Check if a user (non-admin) has an active code
export async function getActiveTemporaryAccessCode(userId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    
    try {
        const now = new Date();
        const snapshot = await db.collection(TEMP_ACCESS_COLLECTION)
            .where('userId', '==', userId)
            .where('status', '==', 'active')
            .get();

        if (snapshot.empty) {
            return { success: true, activeCode: null };
        }
        
        const activeCodes = snapshot.docs
            .map(doc => doc.data() as TemporaryAccess)
            .filter(code => isAfter(parseISO(code.validUntil), now)) // Filter out expired codes in code
            .sort((a, b) => parseISO(b.validFrom).getTime() - parseISO(a.validFrom).getTime()); // Sort by creation time descending

        if (activeCodes.length === 0) {
             return { success: true, activeCode: null };
        }

        // The most recent, non-expired active code is the first one after sorting.
        return { success: true, activeCode: activeCodes[0] };

    } catch (e: any) {
        return { success: false, error: e.message };
    }
}


// Create a temporary access code
export async function createTemporaryAccessCode(data: CreateCodeData): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    const { userId, userEmail, date, startTime, endTime } = data;
    
    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const userRole = userDoc.data()?.role;

        // VVIPs can only have one active code at a time
        if (userRole?.toLowerCase() === 'vvip') {
             const activeCodeCheck = await getActiveTemporaryAccessCode(userId);
             if (activeCodeCheck.success && activeCodeCheck.activeCode) {
                 return { success: false, error: '您已有一個生效中的臨時進出碼。請先將其取消或等待它過期。' };
             }
        }

        const qrSecret = `qs${randomBytes(12).toString('hex')}`;
        
        const bookingStart = parseISO(`${date}T${startTime}:00`);
        let bookingEnd = endTime 
            ? parseISO(`${date}T${endTime}:00`) 
            : add(bookingStart, { minutes: 30 });
        
        if (bookingEnd < bookingStart) {
            bookingEnd = add(bookingEnd, { days: 1 });
        }
        
        const newCode: TemporaryAccess = {
          id: qrSecret,
          userId,
          userEmail,
          validFrom: bookingStart.toISOString(),
          validUntil: bookingEnd.toISOString(),
          status: 'active',
        };
        
        await db.collection(TEMP_ACCESS_COLLECTION).doc(qrSecret).set(newCode);

        // Pass the correct structure to createGoogleCalendarEvent
        const calendarEvent = await createGoogleCalendarEvent({
            id: newCode.id,
            roomId: 'door_control',
            userEmail: newCode.userEmail,
            startTime: newCode.validFrom,
            endTime: newCode.validUntil,
            // These fields are not applicable but satisfy the type for the function
            roomName: '',
            userName: '', 
            userPhone: '',
            date: '', 
            hours: 0,
            costInTokens: 0,
            bookingDate: '',
            status: 'Confirmed',
            paymentMethod: 'tokens',
            qrSecret: qrSecret,
        });

        if (!calendarEvent) {
             console.warn(`Temp access code for ${qrSecret} logged, but failed to create Google Calendar event.`);
        }

        revalidatePath('/admin/bookings', 'page');
        revalidatePath('/(main)/temporary-access', 'page');

        return { success: true, newCode };

    } catch (e: any) {
        console.error('Error creating temporary access code:', e);
        return { success: false, error: e.message || '發生未知錯誤。' };
    }
}

// Cancel a temporary access code
export async function cancelTemporaryAccessCode(codeId: string, userId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    
    try {
        const docRef = db.collection(TEMP_ACCESS_COLLECTION).doc(codeId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { success: false, error: '找不到指定的臨時碼。' };
        }
        
        const codeData = docSnap.data() as TemporaryAccess;
        const userDoc = await db.collection('users').doc(userId).get();
        const userRole = userDoc.data()?.role;

        // Security check: Only the owner or an admin can cancel
        if (codeData.userId !== userId && userRole?.toLowerCase() !== 'admin') {
            return { success: false, error: '權限不足，無法取消此臨時碼。' };
        }

        await docRef.update({ status: 'cancelled' });
        
        // Also delete the calendar event
        await deleteGoogleCalendarEvent(codeData);

        revalidatePath('/admin/bookings', 'page');
        revalidatePath('/(main)/temporary-access', 'page');
        
        return { success: true };
    } catch (e: any) {
         console.error(`Error cancelling temp code ${codeId}:`, e);
        return { success: false, error: e.message };
    }
}
