
'use server';

import { db } from '@/lib/firebase-admin';
import type { Reservation, TemporaryAccess } from '@/types';
import { revalidatePath } from 'next/cache';
import { applyDoorMultiControlCalendar, createGoogleCalendarEvent, holdCalendarId } from '@/lib/google-calendar';
import { getAdminSlotPeriodHkt } from '@/lib/hkt-temp-segment';
import {
  DOOR_MULTI_CONTROLS,
  parseDoorMultiEvents,
  reconcileDoorMultiCoverage,
  type DoorMultiEventRecord,
} from '@/lib/door-multi-controls';
import { parseISO, add, sub, addDays, format, subDays } from 'date-fns';
import { randomBytes } from 'crypto';
import qrcode from 'qrcode';
import { sendQrCodeEmail } from '@/lib/email';
import { createTokenPurchaseRequest } from '@/app/admin/token-requests/actions';
import { getRoomSettings, getHASettings, type RoomSettings } from '@/app/admin/settings/actions';
import { unstable_cache as cache } from 'next/cache';
import admin from 'firebase-admin';
import {
  BLOCKED_SLOTS_COLLECTION,
  emptyHolds,
  expandBookingToHalfHourKeys,
  generateHalfHourSlots,
  isValidHalfHourSlot,
  parseHoldsFromDoc,
  type HoldTable,
  type HoldsByTable,
} from '@/lib/blocked-slots';
import { assertBookingAllowed, BOOKING_CONFLICT_MSG } from '@/lib/booking-validation';

type ServerActionResponse = {
    success: boolean;
    error?: string;
    [key: string]: any;
};

async function assertAdminUser(adminUserId: string): Promise<string | null> {
    if (!db) return '後端資料庫未連接。';
    const adminDoc = await db.collection('users').doc(adminUserId).get();
    const role = adminDoc.data()?.role?.toLowerCase();
    if (!adminDoc.exists || role !== 'admin') {
        return '權限不足。';
    }
    return null;
}

async function getHoldsForDate(date: string): Promise<HoldsByTable> {
    if (!db) return emptyHolds();
    const docSnap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
    if (!docSnap.exists) return emptyHolds();
    return parseHoldsFromDoc(docSnap.data() as Record<string, unknown> | undefined);
}

export async function getBlockedSlotsForDate(date: string): Promise<ServerActionResponse & { holds?: HoldsByTable; slots?: string[] }> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        const holds = await getHoldsForDate(date);
        const slots = [...new Set([...holds['1'], ...holds['2']])];
        return { success: true, holds, slots };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `讀取預留時段失敗: ${msg}` };
    }
}

async function assertBookingNotBlocked(
    date: string,
    startTime: string,
    endTime: string,
    roomId: string,
): Promise<string | null> {
    if (roomId !== '1' && roomId !== '2') return null;
    const keys = expandBookingToHalfHourKeys(date, startTime, endTime);
    if (keys.length === 0) return null;

    const datesToCheck = [...new Set(keys.map((k) => k.date))];
    const blockedByDate = new Map<string, Set<string>>();
    await Promise.all(
        datesToCheck.map(async (d) => {
            const holds = await getHoldsForDate(d);
            blockedByDate.set(d, new Set(holds[roomId]));
        }),
    );

    for (const { date: slotDate, time } of keys) {
        if (blockedByDate.get(slotDate)?.has(time)) {
            return BOOKING_CONFLICT_MSG;
        }
    }
    return null;
}

async function reservationBlockingHold(date: string, toAdd: HoldSlotChange[]): Promise<string | null> {
    if (!db || toAdd.length === 0) return null;
    const previousDate = format(subDays(parseISO(date), 1), 'yyyy-MM-dd');
    const snap = await db.collection('reservations').where('date', 'in', [previousDate, date]).get();
    for (const item of toAdd) {
        const hit = snap.docs.find((docSnap) => {
            const reservation = docSnap.data() as Reservation;
            if (reservation.status === 'Cancelled' || reservation.roomId !== item.table) return false;
            return expandBookingToHalfHourKeys(reservation.date, reservation.startTime, reservation.endTime)
                .some((slot) => slot.date === date && slot.time === item.time);
        });
        if (hit) {
            const reservation = hit.data() as Reservation;
            return `${item.table}號枱在 ${item.time} 已有付費預訂 (#${reservation.id || hit.id})，不能再預留`;
        }
    }
    return null;
}

type HoldSlotChange = { time: string; table: HoldTable };

export async function applyBlockedSlotChanges(
    adminUserId: string,
    changes: { date: string; toAdd: HoldSlotChange[]; toRemove: HoldSlotChange[] }[],
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    const authError = await assertAdminUser(adminUserId);
    if (authError) return { success: false, error: authError };

    const timeSlots = generateHalfHourSlots();
    const mergedByDate = new Map<string, { toAdd: HoldSlotChange[]; toRemove: HoldSlotChange[] }>();

    for (const { date, toAdd, toRemove } of changes) {
        const entry = mergedByDate.get(date) ?? { toAdd: [], toRemove: [] };
        const addKeys = new Set(toAdd.map((item) => `${item.table}|${item.time}`));
        const removeKeys = new Set(toRemove.map((item) => `${item.table}|${item.time}`));
        toAdd
            .filter((item) => isValidHalfHourSlot(item.time, timeSlots) && !removeKeys.has(`${item.table}|${item.time}`))
            .forEach((item) => entry.toAdd.push(item));
        toRemove
            .filter((item) => isValidHalfHourSlot(item.time, timeSlots) && !addKeys.has(`${item.table}|${item.time}`))
            .forEach((item) => entry.toRemove.push(item));
        mergedByDate.set(date, entry);
    }

    const batch = db.batch();
    let hasWrites = false;
    const calendarPlans: {
        date: string;
        table: HoldTable;
        existingEvents: DoorMultiEventRecord[];
        toAdd: string[];
        toRemove: string[];
        storedEvents: { '1': DoorMultiEventRecord[]; '2': DoorMultiEventRecord[] };
    }[] = [];

    for (const [date, { toAdd, toRemove }] of mergedByDate) {
        if (toAdd.length === 0 && toRemove.length === 0) continue;

        const ref = db.collection(BLOCKED_SLOTS_COLLECTION).doc(date);
        const docSnap = await ref.get();
        const data = docSnap.data() as Record<string, unknown> | undefined;
        const current = parseHoldsFromDoc(data);
        const next: HoldsByTable = {
            '1': [...new Set(current['1'])],
            '2': [...new Set(current['2'])],
        };
        for (const item of toAdd) {
            if (!next[item.table].includes(item.time)) next[item.table].push(item.time);
        }
        for (const item of toRemove) {
            next[item.table] = next[item.table].filter((time) => time !== item.time);
        }
        next['1'].sort();
        next['2'].sort();

        const slots = [...new Set([...next['1'], ...next['2']])].sort();
        batch.set(ref, { holds: next, slots }, { merge: true });
        hasWrites = true;

        const storedEvents = data?.doorHoldEvents;
        const storedForDate = {
            '1': parseDoorMultiEvents(
                storedEvents && typeof storedEvents === 'object' ? (storedEvents as Record<string, unknown>)['1'] : undefined,
            ),
            '2': parseDoorMultiEvents(
                storedEvents && typeof storedEvents === 'object' ? (storedEvents as Record<string, unknown>)['2'] : undefined,
            ),
        };
        const legacyEvents = parseDoorMultiEvents(data?.doorMultiEvents)
            .filter((event) => event.actionKey === 'reserved-slot')
            .map((event) => ({ ...event, actionKey: 'reserved-slot-1' }));
        for (const table of ['1', '2'] as const) {
            const tableAdds = toAdd.filter((item) => item.table === table).map((item) => item.time);
            const tableRemoves = toRemove.filter((item) => item.table === table).map((item) => item.time);
            if (tableAdds.length === 0 && tableRemoves.length === 0 && !(table === '1' && legacyEvents.length > 0 && (toAdd.length > 0 || toRemove.length > 0))) {
                continue;
            }
            calendarPlans.push({
                date,
                table,
                existingEvents: table === '1' ? [...storedForDate['1'], ...legacyEvents] : storedForDate['2'],
                toAdd: tableAdds,
                toRemove: tableRemoves,
                storedEvents: storedForDate,
            });
        }
    }

    for (const [date, { toAdd }] of mergedByDate) {
        const holdConflict = await reservationBlockingHold(date, toAdd);
        if (holdConflict) return { success: false, error: holdConflict };
    }

    if (!hasWrites) {
        return { success: false, error: '沒有待更新的預留變更。' };
    }

    try {
        await batch.commit();
        revalidatePath('/new-reservation', 'page');
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `更新預留時段失敗: ${msg}` };
    }

    const calendarWarning = await syncReservedSlotsToHoldCalendars(calendarPlans);
    return calendarWarning ? { success: true, calendarWarning } : { success: true };
}

async function syncReservedSlotsToHoldCalendars(
    plans: { date: string; table: HoldTable; existingEvents: DoorMultiEventRecord[]; toAdd: string[]; toRemove: string[]; storedEvents: { '1': DoorMultiEventRecord[]; '2': DoorMultiEventRecord[] } }[],
): Promise<string | null> {
    if (!db) return null;
    const title = DOOR_MULTI_CONTROLS.reservedSlot.title;
    const warnings: string[] = [];
    const eventsByDate = new Map<string, { '1': DoorMultiEventRecord[]; '2': DoorMultiEventRecord[] }>();

    for (const plan of plans) {
        const actionKey = `reserved-slot-${plan.table}`;
        const { desired, toCreate, toDelete } = reconcileDoorMultiCoverage(
            plan.existingEvents,
            actionKey,
            plan.date,
            plan.toAdd,
            plan.toRemove,
        );
        const bucket = eventsByDate.get(plan.date) ?? {
            '1': [...plan.storedEvents['1']],
            '2': [...plan.storedEvents['2']],
        };
        if (toCreate.length === 0 && toDelete.length === 0) {
            bucket[plan.table] = plan.existingEvents.filter((event) => event.actionKey === actionKey);
            eventsByDate.set(plan.date, bucket);
            continue;
        }

        const calendarResult = await applyDoorMultiControlCalendar({
            calendarId: holdCalendarId(plan.table),
            missingCalendarMessage: plan.table === '1'
                ? '缺少 GOOGLE_CALENDAR_ID_DOOR_CONTROL_Holdtable1。'
                : '缺少 GOOGLE_CALENDAR_ID_DOOR_CONTROL_HoldTable2。',
            title,
            toDeleteEventKeys: toDelete.map((event) => event.eventKey),
            toCreate: toCreate.map((event) => {
                const period = getAdminSlotPeriodHkt(plan.date, event.start, event.end);
                return {
                    eventKey: event.eventKey,
                    startIso: period.validFrom.toISOString(),
                    endIso: period.validUntil.toISOString(),
                    description: `預留時段 枱號${plan.table} ${plan.date} ${event.start}-${event.end}`,
                };
            }),
        });

        if (!calendarResult.ok && calendarResult.error) {
            warnings.push(calendarResult.error);
        }

        const deleted = new Set(calendarResult.deletedKeys);
        const created = new Set(calendarResult.createdKeys);
        const kept = plan.existingEvents.filter((event) => event.actionKey === actionKey && !deleted.has(event.eventKey));
        const createdRecords = desired.filter((event) => created.has(event.eventKey));
        bucket[plan.table] = [...kept, ...createdRecords];
        eventsByDate.set(plan.date, bucket);
    }

    for (const [date, events] of eventsByDate) {
        try {
            const current = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
            const remainingLegacy = parseDoorMultiEvents(current.data()?.doorMultiEvents)
                .filter((event) => event.actionKey !== 'reserved-slot');
            await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).set(
                { doorHoldEvents: events, doorMultiEvents: remainingLegacy },
                { merge: true },
            );
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            warnings.push(msg);
        }
    }

    return warnings.length > 0 ? `預留時段已更新，但日曆同步未完成：${warnings[0]}` : null;
}

export async function blockSlots(
    adminUserId: string,
    slotsByDate: { date: string; slots: string[] }[],
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    const authError = await assertAdminUser(adminUserId);
    if (authError) return { success: false, error: authError };

    const timeSlots = generateHalfHourSlots();
    const batch = db.batch();
    let hasWrites = false;

    for (const { date, slots } of slotsByDate) {
        const validSlots = [...new Set(slots.filter((s) => isValidHalfHourSlot(s, timeSlots)))];
        if (validSlots.length === 0) continue;

        const ref = db.collection(BLOCKED_SLOTS_COLLECTION).doc(date);
        batch.set(
            ref,
            { slots: admin.firestore.FieldValue.arrayUnion(...validSlots) },
            { merge: true },
        );
        hasWrites = true;
    }

    if (!hasWrites) {
        return { success: false, error: '沒有有效的時段可預留。' };
    }

    try {
        await batch.commit();
        revalidatePath('/new-reservation', 'page');
        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `預留時段失敗: ${msg}` };
    }
}

export async function unblockSlot(
    adminUserId: string,
    date: string,
    slot: string,
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    const authError = await assertAdminUser(adminUserId);
    if (authError) return { success: false, error: authError };

    if (!isValidHalfHourSlot(slot)) {
        return { success: false, error: '無效的時段格式。' };
    }

    try {
        const ref = db.collection(BLOCKED_SLOTS_COLLECTION).doc(date);
        const docSnap = await ref.get();
        if (!docSnap.exists) {
            return { success: true };
        }
        await ref.update({ slots: admin.firestore.FieldValue.arrayRemove(slot) });
        revalidatePath('/new-reservation', 'page');
        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: `解除預留失敗: ${msg}` };
    }
}

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

    const blockedError = await assertBookingNotBlocked(data.date, data.startTime, data.endTime, data.roomId);
    if (blockedError) {
        return { success: false, error: blockedError };
    }

    const availabilityError = await assertBookingAllowed(
        db,
        data.roomId,
        data.date,
        data.startTime,
        data.endTime,
    );
    if (availabilityError) {
        return { success: false, error: availabilityError };
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
        const calendarResult = await createGoogleCalendarEvent(newReservation);
        if (calendarResult.ok) {
            if (calendarResult.meta) {
                await db.collection('reservations').doc(refNumber).update({
                    googleCalendarEventId: calendarResult.meta.googleCalendarEventId,
                    googleCalendarDoorSlot: calendarResult.meta.googleCalendarDoorSlot,
                    googleCalendarSyncStatus: 'synced',
                });
            }
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
                const blockedError = await assertBookingNotBlocked(
                    resData.date,
                    resData.startTime,
                    resData.endTime,
                    resData.roomId,
                );
                if (blockedError) {
                    throw new Error(blockedError);
                }

                const availabilityError = await assertBookingAllowed(
                    db,
                    resData.roomId,
                    resData.date,
                    resData.startTime,
                    resData.endTime,
                );
                if (availabilityError) {
                    throw new Error(availabilityError);
                }

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
                const calendarResult = await createGoogleCalendarEvent(newReservation);
                if (calendarResult.ok) {
                    if (calendarResult.meta) {
                        await db.collection('reservations').doc(newReservation.id).update({
                            googleCalendarEventId: calendarResult.meta.googleCalendarEventId,
                            googleCalendarDoorSlot: calendarResult.meta.googleCalendarDoorSlot,
                            googleCalendarSyncStatus: 'synced',
                        });
                    }
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


export async function createPendingFpsReservation(
  data: Omit<Reservation, 'id' | 'bookingDate' | 'qrSecret' | 'paymentMethod'>
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    const blockedError = await assertBookingNotBlocked(data.date, data.startTime, data.endTime, data.roomId);
    if (blockedError) {
        return { success: false, error: blockedError };
    }

    const availabilityError = await assertBookingAllowed(
        db,
        data.roomId,
        data.date,
        data.startTime,
        data.endTime,
    );
    if (availabilityError) {
        return { success: false, error: availabilityError };
    }
    
    // Create a new reservation with 'Pending Fps Payment' status
    const newReservation: Omit<Reservation, 'id' | 'bookingDate' | 'qrSecret'> & { status: 'Pending Fps Payment'; expiresAt: admin.firestore.Timestamp } = {
        ...data,
        status: 'Pending Fps Payment',
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000) // Expires in 10 minutes
    };

    try {
        const docRef = await db.collection('reservations').add(newReservation);
        const createdReservation = { ...newReservation, id: docRef.id };
        
        revalidatePath('/new-reservation', 'page');
        revalidatePath('/admin/bookings', 'page');

        return { success: true, newReservation: createdReservation };
    } catch (e: any) {
        console.error("Error creating pending FPS reservation:", e);
        return { success: false, error: e.message };
    }
}