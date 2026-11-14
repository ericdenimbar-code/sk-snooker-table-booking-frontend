
'use server';

import { db } from '@/lib/firebase-admin';
import type { Reservation, TemporaryAccess } from '@/types';
import { revalidatePath } from 'next/cache';
import { applyDoorMultiControlCalendar, createGoogleCalendarEvent, holdCalendarId, patchHoldEventDescription, patchHoldEventEnd } from '@/lib/google-calendar';
import { getAdminSlotPeriodHkt } from '@/lib/hkt-temp-segment';
import {
  DOOR_MULTI_CONTROLS,
  expandHalfHoursUntil,
  halfHourEndHm,
  parseDoorMultiEvents,
  reconcileDoorMultiCoverage,
  type DoorMultiEventRecord,
} from '@/lib/door-multi-controls';
import { parseISO, add, sub, addDays, format, subDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { randomBytes, randomInt } from 'crypto';
import qrcode from 'qrcode';
import { sendQrCodeEmail } from '@/lib/email';
import { createTokenPurchaseRequest } from '@/app/admin/token-requests/actions';
import { getRoomSettings, getHASettings, type RoomSettings } from '@/app/admin/settings/actions';
import { unstable_cache as cache } from 'next/cache';
import admin from 'firebase-admin';
import {
  BLOCKED_SLOTS_COLLECTION,
  emptyHoldExactEnds,
  emptyHoldPasswords,
  emptyHolds,
  expandBookingToHalfHourKeys,
  generateHalfHourSlots,
  holdNoteLabel,
  isHalfHourSlotPastHkt,
  HKT,
  isValidHalfHourSlot,
  mergeHoldSlotsWithNotes,
  parseHoldExactEndsFromDoc,
  parseHoldNotesFromDoc,
  parseHoldPasswordsFromDoc,
  parseHoldsFromDoc,
  type HoldExactEndsByTable,
  type HoldNotesByTable,
  type HoldPasswordsByTable,
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

function newHoldPasscode(used: Set<string>): string {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const code = String(randomInt(0, 10000)).padStart(4, '0');
        if (!used.has(code)) {
            used.add(code);
            return code;
        }
    }
    const fallback = String(randomInt(0, 10000)).padStart(4, '0');
    used.add(fallback);
    return fallback;
}

function assignHoldPasswords(
    holds: HoldsByTable,
    _notes: HoldNotesByTable,
    current: HoldPasswordsByTable,
    used: Set<string>,
): HoldPasswordsByTable {
    const next: HoldPasswordsByTable = {
        '1': { ...current['1'] },
        '2': { ...current['2'] },
    };
    for (const table of ['1', '2'] as const) {
        for (const time of Object.keys(next[table])) {
            if (!holds[table].includes(time)) delete next[table][time];
        }
        const missing = holds[table].filter((time) => !next[table][time]).sort();
        let run: string[] = [];
        const flush = () => {
            if (run.length === 0) return;
            const password = newHoldPasscode(used);
            for (const time of run) next[table][time] = password;
            run = [];
        };
        for (const time of missing) {
            const previous = run[run.length - 1];
            if (previous && halfHourEndHm(previous) === time) run.push(time);
            else {
                flush();
                run = [time];
            }
        }
        flush();
    }
    return next;
}

function heldSlotsMissingPassword(holds: HoldsByTable, passwords: HoldPasswordsByTable): boolean {
    return (['1', '2'] as const).some((table) => holds[table].some((time) => !passwords[table][time]));
}

export async function getBlockedSlotsForDate(date: string): Promise<ServerActionResponse & {
    holds?: HoldsByTable;
    holdNotes?: HoldNotesByTable;
    holdPasswords?: HoldPasswordsByTable;
    holdExactEnds?: HoldExactEndsByTable;
    slots?: string[];
}> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        const ref = db.collection(BLOCKED_SLOTS_COLLECTION).doc(date);
        const docSnap = await ref.get();
        const data = docSnap.exists ? docSnap.data() as Record<string, unknown> : undefined;
        const holds = parseHoldsFromDoc(data);
        const holdNotes = parseHoldNotesFromDoc(data);
        let holdPasswords = parseHoldPasswordsFromDoc(data);
        const holdExactEnds = parseHoldExactEndsFromDoc(data);
        if (heldSlotsMissingPassword(holds, holdPasswords)) {
            const used = new Set<string>([...Object.values(holdPasswords['1']), ...Object.values(holdPasswords['2'])]);
            holdPasswords = assignHoldPasswords(holds, holdNotes, holdPasswords, used);
            await ref.set({ holdPasswords }, { merge: true });
        }
        const slots = [...new Set([...holds['1'], ...holds['2']])];
        return { success: true, holds, holdNotes, holdPasswords, holdExactEnds, slots };
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
    return writeBlockedSlotChanges(changes);
}

async function writeBlockedSlotChanges(
    changes: { date: string; toAdd: HoldSlotChange[]; toRemove: HoldSlotChange[] }[],
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

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
        const notes = parseHoldNotesFromDoc(data);
        const exactEnds = parseHoldExactEndsFromDoc(data);
        for (const table of ['1', '2'] as const) {
            for (const item of toRemove) {
                if (item.table !== table) continue;
                delete exactEnds[table][item.time];
            }
        }
        const used = new Set<string>([
            ...Object.values(parseHoldPasswordsFromDoc(data)['1']),
            ...Object.values(parseHoldPasswordsFromDoc(data)['2']),
        ]);
        const holdPasswords = assignHoldPasswords(next, notes, parseHoldPasswordsFromDoc(data), used);
        batch.set(ref, { holds: next, slots, holdPasswords, holdExactEnds: exactEnds }, { merge: true });
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

function slotKey(date: string, time: string): string {
    return `${date}|${time}`;
}

function nextHoldBoundary(date: string, time: string): { date: string; time: string } {
    const end = halfHourEndHm(time);
    if (end === '00:00') return { date: format(addDays(parseISO(date), 1), 'yyyy-MM-dd'), time: '00:00' };
    return { date, time: end };
}

function holdEndedMessage(docs: Map<string, Record<string, unknown> | undefined>, slots: { date: string; time: string }[], table: HoldTable): string | null {
    const ordered = [...slots].sort((a, b) => slotKey(a.date, a.time).localeCompare(slotKey(b.date, b.time)));
    const last = ordered[ordered.length - 1];
    if (!last) return null;
    const exact = parseHoldExactEndsFromDoc(docs.get(last.date))[table][last.time];
    const boundary = exact ? { date: last.date, time: exact } : nextHoldBoundary(last.date, last.time);
    if (Date.now() >= hktSlotMs(boundary.date, boundary.time)) return '此時段已結束，不能再修改。';
    return null;
}

function overlappingHoldMessage(
    docs: Map<string, Record<string, unknown> | undefined>,
    table: HoldTable,
    ownSlots: { date: string; time: string }[],
    nextSlots: { date: string; time: string }[],
): string | null {
    const own = new Set(ownSlots.map((slot) => slotKey(slot.date, slot.time)));
    const nextKeys = new Set(nextSlots.map((slot) => slotKey(slot.date, slot.time)));
    const others = new Map<string, { date: string; time: string }[]>();
    for (const [date, data] of docs) {
        const holds = parseHoldsFromDoc(data);
        const passwords = parseHoldPasswordsFromDoc(data);
        for (const time of holds[table]) {
            if (own.has(slotKey(date, time))) continue;
            const password = passwords[table][time] || 'other';
            const list = others.get(password) ?? [];
            list.push({ date, time });
            others.set(password, list);
        }
    }
    for (const [password, slots] of others) {
        const ordered = slots.sort((a, b) => slotKey(a.date, a.time).localeCompare(slotKey(b.date, b.time)));
        const first = ordered[0];
        const end = nextHoldBoundary(ordered[ordered.length - 1].date, ordered[ordered.length - 1].time);
        const overlaps = ordered.some((slot) => nextKeys.has(slotKey(slot.date, slot.time)));
        if (!overlaps) continue;
        const label = password === 'other' ? '' : `（PW: ${password}）`;
        return `警告：${table}號枱 ${first.time} - ${end.time} 已有另一段預留${label}，不能覆蓋該時段。`;
    }
    return null;
}

export async function updateHoldBlock(params: {
    adminUserId: string;
    date: string;
    fromTable: HoldTable;
    fromStart: string;
    fromEnd: string;
    toTable: HoldTable;
    toStart: string;
    toEnd: string;
    note: string;
}): Promise<ServerActionResponse & { days?: { date: string; holds: HoldsByTable; holdNotes: HoldNotesByTable; holdPasswords: HoldPasswordsByTable; holdExactEnds: HoldExactEndsByTable }[] }> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    const authError = await assertAdminUser(params.adminUserId);
    if (authError) return { success: false, error: authError };

    const timeSlots = generateHalfHourSlots();
    for (const time of [params.fromStart, params.fromEnd, params.toStart, params.toEnd]) {
        if (!isValidHalfHourSlot(time, timeSlots)) return { success: false, error: '時段必須是半小時。' };
    }
    if (params.fromStart === params.fromEnd || params.toStart === params.toEnd) {
        return { success: false, error: '開始與結束時間不能相同。' };
    }

    const oldKeys = expandBookingToHalfHourKeys(params.date, params.fromStart, params.fromEnd, timeSlots);
    const newKeys = expandBookingToHalfHourKeys(params.date, params.toStart, params.toEnd, timeSlots);
    if (oldKeys.length === 0 || newKeys.length === 0) {
        return { success: false, error: '找不到要修改的預留時段。' };
    }

    const dates = [...new Set([...oldKeys, ...newKeys].map((slot) => slot.date))];
    const docs = new Map<string, Record<string, unknown> | undefined>();
    for (const date of dates) {
        const snap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
        docs.set(date, snap.exists ? snap.data() as Record<string, unknown> : undefined);
    }

    for (const slot of oldKeys) {
        const holds = parseHoldsFromDoc(docs.get(slot.date));
        if (!holds[params.fromTable].includes(slot.time)) {
            return { success: false, error: '預留時段已變更，請重新整理。' };
        }
    }

    const ended = holdEndedMessage(docs, oldKeys, params.fromTable);
    if (ended) return { success: false, error: ended };

    const neighborDates = new Set(dates);
    for (const date of dates) {
        neighborDates.add(format(subDays(parseISO(date), 1), 'yyyy-MM-dd'));
        neighborDates.add(format(addDays(parseISO(date), 1), 'yyyy-MM-dd'));
    }
    for (const date of neighborDates) {
        if (docs.has(date)) continue;
        const snap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
        docs.set(date, snap.exists ? snap.data() as Record<string, unknown> : undefined);
    }

    const rangeUnchanged = params.fromTable === params.toTable
        && params.fromStart === params.toStart
        && params.fromEnd === params.toEnd;
    if (!rangeUnchanged) {
        const conflict = overlappingHoldMessage(
            docs,
            params.toTable,
            params.fromTable === params.toTable ? oldKeys : [],
            newKeys,
        );
        if (conflict) return { success: false, error: conflict };
    }

    const kept = new Set(
        params.fromTable === params.toTable
            ? oldKeys.filter((slot) => newKeys.some((next) => next.date === slot.date && next.time === slot.time)).map((slot) => `${slot.date}|${slot.time}`)
            : [],
    );
    const toAdd: { date: string; time: string; table: HoldTable }[] = [];
    const toRemove: { date: string; time: string; table: HoldTable }[] = [];

    for (const slot of newKeys) {
        if (kept.has(`${slot.date}|${slot.time}`)) continue;
        const holds = parseHoldsFromDoc(docs.get(slot.date));
        if (holds[params.toTable].includes(slot.time)) {
            return { success: false, error: `${params.toTable}號枱在 ${slot.time} 已預留，不能重疊。` };
        }
        if (isHalfHourSlotPastHkt(slot.date, slot.time)) {
            return { success: false, error: '不能把預留改到已過的時段。' };
        }
        toAdd.push({ date: slot.date, time: slot.time, table: params.toTable });
    }
    for (const slot of oldKeys) {
        if (kept.has(`${slot.date}|${slot.time}`)) continue;
        toRemove.push({ date: slot.date, time: slot.time, table: params.fromTable });
    }

    const priorPassword = oldKeys
        .map((slot) => parseHoldPasswordsFromDoc(docs.get(slot.date))[params.fromTable][slot.time])
        .find((password) => Boolean(password));
    const sameRange = params.fromTable === params.toTable
        && params.fromStart === params.toStart
        && params.fromEnd === params.toEnd;

    let calendarWarning: string | undefined;
    if (toAdd.length > 0 || toRemove.length > 0) {
        const changes = dates.map((date) => ({
            date,
            toAdd: toAdd.filter((item) => item.date === date).map(({ time, table }) => ({ time, table })),
            toRemove: toRemove.filter((item) => item.date === date).map(({ time, table }) => ({ time, table })),
        })).filter((change) => change.toAdd.length > 0 || change.toRemove.length > 0);
        const moved = await applyBlockedSlotChanges(params.adminUserId, changes);
        if (!moved.success) return { success: false, error: moved.error };
        calendarWarning = moved.calendarWarning;
    }

    const note = params.note.trim();
    const password = priorPassword || newHoldPasscode(new Set());
    for (const date of dates) {
        const fresh = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
        const freshData = fresh.data() as Record<string, unknown> | undefined;
        const notes = parseHoldNotesFromDoc(freshData);
        const passwords = parseHoldPasswordsFromDoc(freshData);
        const exactEnds = parseHoldExactEndsFromDoc(freshData);
        for (const slot of oldKeys.filter((item) => item.date === date)) {
            delete notes[params.fromTable][slot.time];
            delete passwords[params.fromTable][slot.time];
            if (!sameRange) delete exactEnds[params.fromTable][slot.time];
        }
        for (const slot of newKeys.filter((item) => item.date === date)) {
            if (note) notes[params.toTable][slot.time] = note;
            else delete notes[params.toTable][slot.time];
            passwords[params.toTable][slot.time] = password;
            if (!sameRange) delete exactEnds[params.toTable][slot.time];
        }
        await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).set({ holdNotes: notes, holdPasswords: passwords, holdExactEnds: exactEnds }, { merge: true });
    }

    const descriptionWarning = await refreshHoldDescriptions(dates);
    if (descriptionWarning) calendarWarning = calendarWarning ?? descriptionWarning;

    const days = [];
    for (const date of dates) {
        const snap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
        const data = snap.data() as Record<string, unknown> | undefined;
        days.push({
            date,
            holds: parseHoldsFromDoc(data),
            holdNotes: parseHoldNotesFromDoc(data),
            holdPasswords: parseHoldPasswordsFromDoc(data),
            holdExactEnds: parseHoldExactEndsFromDoc(data),
        });
    }
    revalidatePath('/new-reservation', 'page');
    revalidatePath('/admin/bookings', 'page');
    return calendarWarning ? { success: true, calendarWarning, days } : { success: true, days };
}

export async function cancelHoldBlock(params: {
    adminUserId: string;
    date: string;
    table: HoldTable;
    start: string;
    end: string;
}): Promise<ServerActionResponse & { days?: { date: string; holds: HoldsByTable; holdNotes: HoldNotesByTable; holdPasswords: HoldPasswordsByTable; holdExactEnds: HoldExactEndsByTable }[] }> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    const authError = await assertAdminUser(params.adminUserId);
    if (authError) return { success: false, error: authError };

    const timeSlots = generateHalfHourSlots();
    if (!isValidHalfHourSlot(params.start, timeSlots) || !isValidHalfHourSlot(params.end, timeSlots)) {
        return { success: false, error: '時段必須是半小時。' };
    }
    if (params.start === params.end) return { success: false, error: '找不到要取消的預留時段。' };

    const keys = expandBookingToHalfHourKeys(params.date, params.start, params.end, timeSlots);
    if (keys.length === 0) return { success: false, error: '找不到要取消的預留時段。' };

    const dates = [...new Set(keys.map((slot) => slot.date))];
    for (const slot of keys) {
        const snap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(slot.date).get();
        const holds = parseHoldsFromDoc(snap.exists ? snap.data() as Record<string, unknown> : undefined);
        if (!holds[params.table].includes(slot.time)) {
            return { success: false, error: '預留時段已變更，請重新整理。' };
        }
    }

    const removed = await applyBlockedSlotChanges(params.adminUserId, dates.map((date) => ({
        date,
        toAdd: [],
        toRemove: keys.filter((slot) => slot.date === date).map((slot) => ({ time: slot.time, table: params.table })),
    })));
    if (!removed.success) return { success: false, error: removed.error };

    let noteWarning: string | undefined;
    try {
        for (const date of dates) {
            const fresh = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
            const notes = parseHoldNotesFromDoc(fresh.data() as Record<string, unknown> | undefined);
            for (const slot of keys.filter((item) => item.date === date)) {
                delete notes[params.table][slot.time];
            }
            await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).set({ holdNotes: notes }, { merge: true });
        }
    } catch (e: unknown) {
        noteWarning = e instanceof Error ? e.message : '備注未能清除。';
    }

    const days = [];
    for (const date of dates) {
        const snap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
        const data = snap.data() as Record<string, unknown> | undefined;
        days.push({
            date,
            holds: parseHoldsFromDoc(data),
            holdNotes: parseHoldNotesFromDoc(data),
            holdPasswords: parseHoldPasswordsFromDoc(data),
            holdExactEnds: parseHoldExactEndsFromDoc(data),
        });
    }
    revalidatePath('/new-reservation', 'page');
    revalidatePath('/admin/bookings', 'page');
    const calendarWarning = removed.calendarWarning ?? (noteWarning ? `預留已取消，但備注未能清除：${noteWarning}` : undefined);
    return calendarWarning ? { success: true, calendarWarning, days } : { success: true, days };
}

async function refreshHoldDescriptions(dates: string[]): Promise<string | null> {
    if (!db) return null;
    const warnings: string[] = [];
    for (const date of dates) {
        const snap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
        const data = snap.data() as Record<string, unknown> | undefined;
        const notes = parseHoldNotesFromDoc(data);
        const stored = data?.doorHoldEvents;
        for (const table of ['1', '2'] as const) {
            const events = parseDoorMultiEvents(
                stored && typeof stored === 'object' ? (stored as Record<string, unknown>)[table] : undefined,
            );
            for (const event of events) {
                const slotNotes = [...new Set(
                    expandHalfHoursUntil(event.start, event.end)
                        .map((time) => notes[table][time])
                        .filter((value): value is string => Boolean(value)),
                )];
                const description = [
                    `預留時段 枱號${table} ${date} ${event.start}-${event.end}`,
                    ...slotNotes.map((value) => holdNoteLabel(value)),
                ].join('\n');
                const error = await patchHoldEventDescription(table, event.eventKey, description);
                if (error) warnings.push(error);
            }
        }
    }
    return warnings[0] ?? null;
}

const CLOSEDOOR_GUARD = 'closedoorGuard';
const CLOSEDOOR_LOCK_MS = 15 * 60 * 1000;
const CLOSEDOOR_MAX_FAILURES = 10;

export type CloseHoldResult =
    | { status: 'ok'; table: HoldTable; closedAt: string; releasedFrom: string | null; releasedUntil: string | null; calendarWarning?: string }
    | { status: 'invalid' | 'locked' | 'not-started' | 'ended' | 'failed'; error?: string };

function hktSlotMs(date: string, time: string): number {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return fromZonedTime(new Date(year, month - 1, day, hour, minute, 0, 0), HKT).getTime();
}

function releaseBoundary(now: Date): { date: string; time: string } {
    const date = formatInTimeZone(now, HKT, 'yyyy-MM-dd');
    const [hour, minute, second] = formatInTimeZone(now, HKT, 'HH:mm:ss').split(':').map(Number);
    const total = hour * 60 + minute;
    const next = second === 0 && minute % 30 === 0 ? total : (Math.floor(total / 30) + 1) * 30;
    if (next >= 24 * 60) return { date: format(addDays(parseISO(date), 1), 'yyyy-MM-dd'), time: '00:00' };
    return { date, time: `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}` };
}

function atOrAfter(slot: { date: string; time: string }, boundary: { date: string; time: string }): boolean {
    return slot.date > boundary.date || (slot.date === boundary.date && slot.time >= boundary.time);
}

type HoldSlotRef = { date: string; time: string; table: HoldTable };
type ActiveHold = { table: HoldTable; slots: HoldSlotRef[]; endLabel: string };

async function readNearbyHoldDocs(now: Date): Promise<{ dates: string[]; docs: Map<string, Record<string, unknown> | undefined> } | null> {
    if (!db) return null;
    const today = formatInTimeZone(now, HKT, 'yyyy-MM-dd');
    const dates = [format(subDays(parseISO(today), 1), 'yyyy-MM-dd'), today, format(addDays(parseISO(today), 1), 'yyyy-MM-dd')];
    const docs = new Map<string, Record<string, unknown> | undefined>();
    for (const date of dates) {
        const snap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
        docs.set(date, snap.exists ? snap.data() as Record<string, unknown> : undefined);
    }
    return { dates, docs };
}

function collectHoldGroups(docs: Map<string, Record<string, unknown> | undefined>, dates: string[]): Map<string, HoldSlotRef[]> {
    const groups = new Map<string, HoldSlotRef[]>();
    for (const date of dates) {
        const data = docs.get(date);
        const holds = parseHoldsFromDoc(data);
        const passwords = parseHoldPasswordsFromDoc(data);
        for (const table of ['1', '2'] as const) {
            for (const time of holds[table]) {
                const password = passwords[table][time];
                const key = `${table}|${password || 'nopw'}`;
                const list = groups.get(key) ?? [];
                list.push({ date, time, table });
                groups.set(key, list);
            }
        }
    }
    return groups;
}

function contiguousHoldRuns(slots: HoldSlotRef[]): HoldSlotRef[][] {
    const ordered = [...slots].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const runs: HoldSlotRef[][] = [];
    let current: HoldSlotRef[] = [];
    const follows = (prev: HoldSlotRef, slot: HoldSlotRef) => {
        const end = halfHourEndHm(prev.time);
        if (end === '00:00') {
            return slot.time === '00:00' && slot.date === format(addDays(parseISO(prev.date), 1), 'yyyy-MM-dd');
        }
        return prev.date === slot.date && slot.time === end;
    };
    for (const slot of ordered) {
        const prev = current[current.length - 1];
        if (!prev || follows(prev, slot)) current.push(slot);
        else {
            runs.push(current);
            current = [slot];
        }
    }
    if (current.length > 0) runs.push(current);
    return runs;
}

function describeHold(slots: HoldSlotRef[], docs: Map<string, Record<string, unknown> | undefined>, nowMs: number):
    | { kind: 'active'; hold: ActiveHold }
    | { kind: 'future' }
    | { kind: 'ended' } {
    const ordered = [...slots].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const exact = parseHoldExactEndsFromDoc(docs.get(last.date))[last.table][last.time];
    const endHm = exact || halfHourEndHm(last.time);
    const endDate = !exact && endHm === '00:00' ? format(addDays(parseISO(last.date), 1), 'yyyy-MM-dd') : last.date;
    const startMs = hktSlotMs(first.date, first.time);
    const endMs = hktSlotMs(endDate, endHm === '00:00' && !exact ? '00:00' : endHm);
    if (nowMs < startMs) return { kind: 'future' };
    if (nowMs >= endMs) return { kind: 'ended' };
    return { kind: 'active', hold: { table: first.table, slots: ordered, endLabel: endHm } };
}

async function applyHoldClose(active: ActiveHold, now: Date, dates: string[]): Promise<{ error?: string; calendarWarning?: string; releasedFrom: string | null; releasedUntil: string | null }> {
    const boundary = releaseBoundary(now);
    const removing = active.slots.filter((slot) => atOrAfter(slot, boundary));
    const keeping = active.slots.filter((slot) => !atOrAfter(slot, boundary));
    const closedAt = formatInTimeZone(now, HKT, 'HH:mm');
    let calendarWarning: string | undefined;

    if (removing.length > 0) {
        const changes = dates.map((date) => ({
            date,
            toAdd: [] as { time: string; table: HoldTable }[],
            toRemove: removing.filter((slot) => slot.date === date).map((slot) => ({ time: slot.time, table: slot.table })),
        })).filter((change) => change.toRemove.length > 0);
        const removed = await commitBlockedSlotChanges(changes);
        if (!removed.success) return { error: removed.error, releasedFrom: null, releasedUntil: null };
        calendarWarning = removed.calendarWarning;
    }

    if (keeping.length > 0 && db) {
        const last = keeping[keeping.length - 1];
        const datesKept = [...new Set(keeping.map((slot) => slot.date))];
        let eventData: Record<string, unknown> | undefined;
        for (const date of datesKept) {
            const fresh = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
            const exactEnds = parseHoldExactEndsFromDoc(fresh.data() as Record<string, unknown> | undefined);
            for (const slot of keeping.filter((item) => item.date === date)) delete exactEnds[slot.table][slot.time];
            if (date === last.date) exactEnds[last.table][last.time] = closedAt;
            await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).set({ holdExactEnds: exactEnds }, { merge: true });
            if (date === last.date) eventData = fresh.data() as Record<string, unknown> | undefined;
        }

        const events = parseDoorMultiEvents(
            (eventData?.doorHoldEvents as Record<string, unknown> | undefined)?.[last.table],
        );
        const event = events.find((item) => expandHalfHoursUntil(item.start, item.end).includes(last.time));
        if (event) {
            const period = getAdminSlotPeriodHkt(last.date, event.start, halfHourEndHm(last.time));
            const patched = await patchHoldEventEnd(last.table, event.eventKey, period.validFrom.toISOString(), now.toISOString());
            if (patched) calendarWarning = calendarWarning ?? patched;
        } else if (!calendarWarning) {
            calendarWarning = '預留已結束，但找不到要縮短的日曆項目。';
        }
    }

    return {
        calendarWarning,
        releasedFrom: removing[0]?.time ?? null,
        releasedUntil: removing.length > 0 ? active.endLabel : null,
    };
}

export async function closeHoldByPasscode(passcode: string): Promise<CloseHoldResult> {
    if (!/^\d{4}$/.test(passcode)) return { status: 'invalid' };
    if (!db) return { status: 'failed', error: '後端資料庫未連接。' };
    const guardRef = db.collection(CLOSEDOOR_GUARD).doc('current');
    const guard = await guardRef.get();
    const lockedUntil = typeof guard.data()?.lockedUntilMs === 'number' ? guard.data()?.lockedUntilMs as number : 0;
    if (lockedUntil > Date.now()) return { status: 'locked' };

    const now = new Date();
    const loaded = await readNearbyHoldDocs(now);
    if (!loaded) return { status: 'failed', error: '後端資料庫未連接。' };
    const groups = collectHoldGroups(loaded.docs, loaded.dates);
    const matches = [...groups.entries()].filter(([key]) => key.endsWith(`|${passcode}`));
    if (matches.length === 0) {
        await noteClosedoorFailure(guard.data()?.failedAttempts);
        return { status: 'invalid' };
    }

    let active: ActiveHold | null = null;
    let sawFuture = false;
    let sawEnded = false;
    for (const [, slots] of matches) {
        const described = describeHold(slots, loaded.docs, now.getTime());
        if (described.kind === 'future') sawFuture = true;
        else if (described.kind === 'ended') sawEnded = true;
        else active = described.hold;
    }
    if (!active) {
        await guardRef.set({ failedAttempts: 0, lockedUntilMs: 0 }, { merge: true });
        return sawFuture ? { status: 'not-started' } : sawEnded ? { status: 'ended' } : { status: 'invalid' };
    }

    const applied = await applyHoldClose(active, now, loaded.dates);
    if (applied.error) return { status: 'failed', error: applied.error };

    await guardRef.set({ failedAttempts: 0, lockedUntilMs: 0 }, { merge: true });
    revalidatePath('/new-reservation', 'page');
    revalidatePath('/admin/bookings', 'page');
    return {
        status: 'ok',
        table: active.table,
        closedAt: formatInTimeZone(now, HKT, 'HH:mm'),
        releasedFrom: applied.releasedFrom,
        releasedUntil: applied.releasedUntil,
        calendarWarning: applied.calendarWarning,
    };
}

export async function closeActiveHoldForAdmin(adminUserId: string, table: HoldTable, now = new Date()): Promise<CloseHoldResult> {
    const authError = await assertAdminUser(adminUserId);
    if (authError) return { status: 'failed', error: authError };
    const loaded = await readNearbyHoldDocs(now);
    if (!loaded) return { status: 'failed', error: '後端資料庫未連接。' };

    const actives: ActiveHold[] = [];
    let sawFuture = false;
    for (const [key, slots] of collectHoldGroups(loaded.docs, loaded.dates)) {
        if (!key.startsWith(`${table}|`)) continue;
        for (const run of contiguousHoldRuns(slots)) {
            const described = describeHold(run, loaded.docs, now.getTime());
            if (described.kind === 'active') actives.push(described.hold);
            else if (described.kind === 'future') sawFuture = true;
        }
    }
    if (actives.length === 0) return sawFuture ? { status: 'not-started' } : { status: 'ended' };

    let calendarWarning: string | undefined;
    let releasedFrom: string | null = null;
    let releasedUntil: string | null = null;
    for (const active of actives) {
        const applied = await applyHoldClose(active, now, loaded.dates);
        if (applied.error) return { status: 'failed', error: applied.error };
        calendarWarning = calendarWarning ?? applied.calendarWarning;
        releasedFrom = releasedFrom ?? applied.releasedFrom;
        releasedUntil = releasedUntil ?? applied.releasedUntil;
    }
    revalidatePath('/new-reservation', 'page');
    revalidatePath('/admin/bookings', 'page');
    return {
        status: 'ok',
        table,
        closedAt: formatInTimeZone(now, HKT, 'HH:mm'),
        releasedFrom,
        releasedUntil,
        calendarWarning,
    };
}

async function noteClosedoorFailure(failedAttempts: unknown) {
    if (!db) return;
    const guardRef = db.collection(CLOSEDOOR_GUARD).doc('current');
    const attempts = (typeof failedAttempts === 'number' ? failedAttempts : 0) + 1;
    if (attempts >= CLOSEDOOR_MAX_FAILURES) {
        await guardRef.set({ failedAttempts: 0, lockedUntilMs: Date.now() + CLOSEDOOR_LOCK_MS }, { merge: true });
        return;
    }
    await guardRef.set({ failedAttempts: attempts }, { merge: true });
}

async function commitBlockedSlotChanges(
    changes: { date: string; toAdd: { time: string; table: HoldTable }[]; toRemove: { time: string; table: HoldTable }[] }[],
): Promise<ServerActionResponse> {
    return writeBlockedSlotChanges(changes);
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
        const passwordDoc = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(plan.date).get();
        const tablePasswords = parseHoldPasswordsFromDoc(passwordDoc.data() as Record<string, unknown> | undefined)[plan.table];
        const { desired, toCreate, toDelete } = reconcileDoorMultiCoverage(
            plan.existingEvents,
            actionKey,
            plan.date,
            plan.toAdd,
            plan.toRemove,
            tablePasswords,
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