
'use server';

import { formatInTimeZone } from 'date-fns-tz';
import { revalidatePath } from 'next/cache';
import admin from 'firebase-admin';
import qrcode from 'qrcode';
import { db } from '@/lib/firebase-admin';
import { getUserByEmail } from '@/app/admin/users/actions';
import { deleteGoogleCalendarEventsForReservation } from '@/lib/google-calendar';
import { sendQrCodeEmail } from '@/lib/email';
import { getRoomSettings } from '@/app/admin/settings/actions';
import type { Reservation, TemporaryAccess } from '@/types';
import {
  getAdminDayWindow,
  HKT,
  reservationInAdminWindow,
  sortReservationsByStartDesc,
  tempAccessInAdminWindow,
  adminTempAccessQueryFromIso,
} from '@/lib/admin-bookings-query';

type AdminBookingsInitialData = {
  success: boolean;
  error?: string;
  reservations?: Reservation[];
  accessCodes?: TemporaryAccess[];
};

type ServerActionResponse = {
    success: boolean;
    error?: string;
    calendarSynced?: boolean;
    calendarWarning?: string;
};

export async function getAdminBookingsInitialData(dayYmd?: string): Promise<AdminBookingsInitialData> {
  if (!db) {
    return { success: false, error: '後端資料庫未連接。' };
  }

  const anchorYmd = dayYmd ?? formatInTimeZone(new Date(), HKT, 'yyyy-MM-dd');
  const window = getAdminDayWindow(anchorYmd);

  try {
    const [resSnapshot, tempSnapshot] = await Promise.all([
      db
        .collection('reservations')
        .where('date', 'in', [...window.queryDates])
        .limit(50)
        .get(),
      db
        .collection('temporaryAccess')
        .where('validUntil', '>=', adminTempAccessQueryFromIso(window))
        .orderBy('validUntil', 'desc')
        .limit(50)
        .get(),
    ]);

    const reservations = resSnapshot.docs
      .map((doc) => doc.data() as Reservation)
      .filter((r) => reservationInAdminWindow(r, window))
      .sort(sortReservationsByStartDesc);

    const accessCodes = tempSnapshot.docs
      .map((doc) => {
        const data = doc.data() as TemporaryAccess;
        return { ...data, id: data.id ?? doc.id };
      })
      .filter((t) => t.status === 'active')
      .filter((t) => tempAccessInAdminWindow(t, window));

    return { success: true, reservations, accessCodes };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: `讀取預約資料失敗：${message}` };
  }
}

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
        
        const cancelledAt = new Date().toISOString();

        // Use a transaction to ensure atomicity — DB status first, calendar sync after
        await db.runTransaction(async (transaction) => {
            const reservationRef = db.collection('reservations').doc(reservation.id);
            transaction.update(reservationRef, {
                status: 'Cancelled',
                cancelledAt,
                googleCalendarSyncStatus: 'pending_delete',
            });

            if (amountToRefund > 0 && user) {
                const userRef = db.collection('users').doc(user.id);
                transaction.update(userRef, { tokens: admin.firestore.FieldValue.increment(amountToRefund) });
            }
        });

        const reservationForCalendar: Reservation = {
            ...reservation,
            status: 'Cancelled',
            cancelledAt,
            googleCalendarEventId:
                reservation.googleCalendarEventId ??
                undefined,
        };

        let calendarSynced = true;
        let calendarWarning: string | undefined;

        try {
            const calendarResult = await deleteGoogleCalendarEventsForReservation(reservationForCalendar);
            const reservationRef = db.collection('reservations').doc(reservation.id);

            if (calendarResult.success) {
                await reservationRef.update({ googleCalendarSyncStatus: 'synced' });
            } else {
                calendarSynced = false;
                calendarWarning =
                    '預訂已取消，但 Google Calendar 同步未完成。系統將每小時自動校對並清除殘留日程；您也可稍後再試。';
                console.error(
                    `[Google Calendar] Cancel sync failed for ${reservation.id}:`,
                    calendarResult.errors.join('; '),
                );
                await reservationRef.update({ googleCalendarSyncStatus: 'delete_failed' });
            }
        } catch (calendarError: unknown) {
            calendarSynced = false;
            const message = calendarError instanceof Error ? calendarError.message : String(calendarError);
            calendarWarning =
                '預訂已取消，但 Google Calendar 同步發生錯誤。系統將每小時自動校對並清除殘留日程；您也可稍後再試。';
            console.error(`[Google Calendar] Cancel sync error for ${reservation.id}:`, message);
            await db.collection('reservations').doc(reservation.id).update({
                googleCalendarSyncStatus: 'delete_failed',
            });
        }

        // Revalidate paths to update caches
        revalidatePath('/admin/bookings', 'page');
        revalidatePath('/reservations', 'page');
        if (user) {
            revalidatePath(`/admin/users`);
        }

        return { success: true, calendarSynced, calendarWarning };

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
