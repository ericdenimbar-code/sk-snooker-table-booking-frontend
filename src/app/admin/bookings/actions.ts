
'use server';

import { formatInTimeZone } from 'date-fns-tz';
import { addDays, format, parseISO, subDays } from 'date-fns';
import { revalidatePath } from 'next/cache';
import admin from 'firebase-admin';
import qrcode from 'qrcode';
import { db } from '@/lib/firebase-admin';
import { getUserByEmail } from '@/app/admin/users/actions';
import {
  allocateDoorAccessSlot,
  deleteGoogleCalendarEventsForReservation,
  DOOR_ACCESS_LEAD_MINUTES,
  DOOR_ACCESS_TRAIL_MINUTES,
  getGoogleCalendarEventId,
  recreateReservationCalendarEvents,
} from '@/lib/google-calendar';
import { sendBookingChangeEmail, sendQrCodeEmail } from '@/lib/email';
import { getRoomSettings } from '@/app/admin/settings/actions';
import { getAdminSlotPeriodHkt } from '@/lib/hkt-temp-segment';
import { generateHalfHourSlots, isValidHalfHourSlot } from '@/lib/blocked-slots';
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


export async function updateReservationSummary(
  reservationId: string,
  summary: string,
): Promise<ServerActionResponse> {
  if (!db) return { success: false, error: '後端資料庫未連接。' };
  const id = reservationId.trim();
  if (!id) return { success: false, error: '找不到預訂記錄。' };

  try {
    const ref = db.collection('reservations').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { success: false, error: '找不到預訂記錄。' };
    await ref.update({ summary: summary.trim() });
    return { success: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: `無法儲存摘要：${message}` };
  }
}

function reservationInterval(date: string, startTime: string, endTime: string): { start: Date; end: Date } | null {
    if (!date || !startTime || !endTime || !date.includes('-') || !startTime.includes(':') || !endTime.includes(':')) {
        return null;
    }
    try {
        const period = getAdminSlotPeriodHkt(date, startTime, endTime);
        if (!period.validFrom || !period.validUntil) return null;
        return { start: period.validFrom, end: period.validUntil };
    } catch {
        return null;
    }
}

function toClientReservation(reservation: Reservation): Reservation {
    const { expiresAt: _expiresAt, ...rest } = reservation;
    return JSON.parse(JSON.stringify(rest)) as Reservation;
}

function intervalsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
    return a.start < b.end && a.end > b.start;
}

export async function updateAdminReservation(params: {
    adminUserId: string;
    reservationId: string;
    roomId: '1' | '2';
    startTime: string;
    endTime: string;
}): Promise<ServerActionResponse & { reservation?: Reservation }> {
    try {
        return await updateAdminReservationInner(params);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error('[updateAdminReservation]', message);
        return { success: false, error: message || '修改預訂時發生錯誤。' };
    }
}

async function updateAdminReservationInner(params: {
    adminUserId: string;
    reservationId: string;
    roomId: '1' | '2';
    startTime: string;
    endTime: string;
}): Promise<ServerActionResponse & { reservation?: Reservation }> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    const adminDoc = await db.collection('users').doc(params.adminUserId).get();
    if (!adminDoc.exists || String(adminDoc.data()?.role ?? '').toLowerCase() !== 'admin') {
        return { success: false, error: '權限不足。' };
    }

    const slots = generateHalfHourSlots();
    if (!isValidHalfHourSlot(params.startTime, slots) || !isValidHalfHourSlot(params.endTime, slots)) {
        return { success: false, error: '開始與結束時間須為半小時正點。' };
    }
    if (params.startTime === params.endTime) {
        return { success: false, error: '結束時間必須晚於開始時間。' };
    }
    if (params.roomId !== '1' && params.roomId !== '2') {
        return { success: false, error: '無效的枱號。' };
    }

    const ref = db.collection('reservations').doc(params.reservationId);
    const snap = await ref.get();
    if (!snap.exists) return { success: false, error: '找不到預訂。' };
    const current = snap.data() as Reservation;
    if (current.status === 'Cancelled') return { success: false, error: '已取消的預訂不能修改。' };

    const currentInterval = reservationInterval(current.date, current.startTime, current.endTime);
    if (!currentInterval) return { success: false, error: '這筆預訂的日期或時間格式不正確，無法修改。' };
    if (currentInterval.end.getTime() <= Date.now()) {
        return { success: false, error: '此預訂已結束，不能修改。' };
    }

    const nextInterval = reservationInterval(current.date, params.startTime, params.endTime);
    if (!nextInterval) return { success: false, error: '開始或結束時間不正確。' };
    if (nextInterval.end.getTime() <= Date.now()) {
        return { success: false, error: '新的結束時間必須晚於現在。' };
    }

    const dates = [
        format(subDays(parseISO(current.date), 1), 'yyyy-MM-dd'),
        current.date,
        format(addDays(parseISO(current.date), 1), 'yyyy-MM-dd'),
    ];
    const overlapSnap = await db.collection('reservations').where('date', 'in', dates).get();
    const conflict = overlapSnap.docs
        .map((doc) => doc.data() as Reservation)
        .find((other) => {
            if (other.id === current.id || other.roomId !== params.roomId || other.status === 'Cancelled') return false;
            const otherInterval = reservationInterval(other.date, other.startTime, other.endTime);
            if (!otherInterval) return false;
            return intervalsOverlap(nextInterval, otherInterval);
        });
    if (conflict) {
        const roomLabel = `${params.roomId}號枱`;
        return {
            success: false,
            error: `${roomLabel}在 ${conflict.startTime} - ${conflict.endTime} 已有預訂 (#${conflict.id})，無法轉移/延長`,
        };
    }

    const entryStart = new Date(nextInterval.start.getTime() - DOOR_ACCESS_LEAD_MINUTES * 60 * 1000);
    const entryEnd = new Date(nextInterval.end.getTime() + DOOR_ACCESS_TRAIL_MINUTES * 60 * 1000);
    const excludeIds = [
        current.googleCalendarEventId,
        getGoogleCalendarEventId(current.id),
    ].filter((id): id is string => Boolean(id));
    const door = await allocateDoorAccessSlot(params.roomId, entryStart, entryEnd, excludeIds, current.id);
    if (!door) {
        return {
            success: false,
            error: `${params.roomId}號枱的入門行事曆 A 與 B 在通行時段都已被佔用，無法修改。`,
        };
    }

    const roomSettings = await getRoomSettings(params.roomId);
    const roomName = roomSettings?.name || `枱號${params.roomId}`;
    const hours = (nextInterval.end.getTime() - nextInterval.start.getTime()) / (60 * 60 * 1000);
    const nextFields = {
        id: current.id,
        roomId: params.roomId,
        roomName,
        date: current.date,
        startTime: params.startTime,
        endTime: params.endTime,
        userName: current.userName,
        userPhone: current.userPhone,
        qrSecret: current.qrSecret,
    };

    const calendarResult = await recreateReservationCalendarEvents({
        previous: current,
        next: nextFields,
        doorSlot: door.slot,
    });
    if (!calendarResult.ok) return { success: false, error: calendarResult.error };

    const updated: Reservation = {
        ...current,
        roomId: params.roomId,
        roomName,
        startTime: params.startTime,
        endTime: params.endTime,
        hours,
        googleCalendarEventId: calendarResult.googleCalendarEventId,
        googleCalendarDoorSlot: door.slot,
        doorAccessCalendarId: calendarResult.doorAccessCalendarId,
        googleCalendarSyncStatus: 'synced',
    };

    try {
        await ref.update({
            roomId: updated.roomId,
            roomName: updated.roomName,
            startTime: updated.startTime,
            endTime: updated.endTime,
            hours: updated.hours,
            googleCalendarEventId: updated.googleCalendarEventId,
            googleCalendarDoorSlot: updated.googleCalendarDoorSlot,
            doorAccessCalendarId: updated.doorAccessCalendarId,
            googleCalendarSyncStatus: 'synced',
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        return { success: false, error: `行事曆已更新，但資料庫寫入失敗：${message}` };
    }

    revalidatePath('/admin/bookings', 'page');
    revalidatePath('/reservations', 'page');

    let calendarWarning: string | undefined;
    try {
        const settings = await getRoomSettings('1');
        const qrCodeDataUrl = await qrcode.toDataURL(current.qrSecret, { errorCorrectionLevel: 'H', margin: 2, scale: 8 });
        const emailed = settings
            ? await sendBookingChangeEmail({
                reservation: updated,
                roomLabel: roomName.replace('房間', '枱號'),
                entryStart,
                entryEnd,
                qrCodeDataUrl,
                contactInfo: settings.contactInfo,
            })
            : false;
        if (!emailed) calendarWarning = '預訂已更新，但變更通知電郵未能送出。';
    } catch (e: unknown) {
        console.error('[updateAdminReservation] email failed', e);
        calendarWarning = '預訂已更新，但變更通知電郵未能送出。';
    }

    return { success: true, reservation: toClientReservation(updated), calendarWarning };
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
