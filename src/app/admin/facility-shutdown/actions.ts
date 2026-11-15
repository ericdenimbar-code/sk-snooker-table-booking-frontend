'use server';

import { format, parseISO, subDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import {
  applyBlockedSlotChanges,
  closeActiveHoldForAdmin,
  listActiveHoldPanels,
  readFacilityPasswords,
  regenerateFacilityPasswords,
} from '@/app/(main)/new-reservation/actions';
import { db } from '@/lib/firebase-admin';
import { endActiveHoldCalendarEvents } from '@/lib/google-calendar';
import { getHktBookingStartUtc } from '@/lib/hkt-temp-segment';
import {
  BLOCKED_SLOTS_COLLECTION,
  expandBookingToHalfHourKeys,
  HKT,
  parseHoldExactStartsFromDoc,
  parseHoldsFromDoc,
  type HoldTable,
} from '@/lib/blocked-slots';
import type { Reservation } from '@/types';

const ALL_OFF_GAP_MS = 30_000;

export type TableControl = {
  on: boolean;
  start: string | null;
  end: string | null;
  password: string;
};

export type FacilityControlState = {
  success: boolean;
  error?: string;
  table1: TableControl;
  table2: TableControl;
  allOffPassword: string;
};

const DURATION_HOURS = new Set([0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

async function requireAdmin(adminUserId: string): Promise<string | null> {
  if (!adminUserId) return '找不到管理員身分，請重新登入。';
  if (!db) return '後端資料庫未連接。';
  const adminDoc = await db.collection('users').doc(adminUserId).get();
  const role = String(adminDoc.data()?.role ?? '').toLowerCase();
  if (!adminDoc.exists || role !== 'admin') return '權限不足。';
  return null;
}

function floorHalfHour(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${String(hour).padStart(2, '0')}:${minute < 30 ? '00' : '30'}`;
}

function holdWindow(now: Date, hours: number): { startDate: string; startHm: string; endDate: string; endHm: string } {
  const startDate = formatInTimeZone(now, HKT, 'yyyy-MM-dd');
  const startHm = formatInTimeZone(now, HKT, 'HH:mm');
  const start = getHktBookingStartUtc(startDate, startHm);
  const target = new Date(start.getTime() + hours * 60 * 60 * 1000);
  const minute = Number(formatInTimeZone(target, HKT, 'm'));
  const second = Number(formatInTimeZone(target, HKT, 's'));
  const remainder = minute % 30;
  const extra = remainder === 0 && second === 0 ? 0 : remainder === 0 ? 30 : 30 - remainder;
  const end = new Date(target.getTime() + extra * 60 * 1000 - second * 1000);
  return {
    startDate,
    startHm,
    endDate: formatInTimeZone(end, HKT, 'yyyy-MM-dd'),
    endHm: formatInTimeZone(end, HKT, 'HH:mm'),
  };
}

async function rangeConflict(table: HoldTable, slots: { date: string; time: string }[]): Promise<string | null> {
  if (!db || slots.length === 0) return null;
  const dates = [...new Set(slots.flatMap((slot) => [slot.date, format(subDays(parseISO(slot.date), 1), 'yyyy-MM-dd')]))].slice(0, 10);
  const [snap, holdDocs] = await Promise.all([
    db.collection('reservations').where('date', 'in', dates).get(),
    Promise.all([...new Set(slots.map((slot) => slot.date))].map(async (date) => {
      const holdDoc = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
      return [date, parseHoldsFromDoc(holdDoc.data() as Record<string, unknown> | undefined)] as const;
    })),
  ]);
  const holdsByDate = new Map(holdDocs);
  for (const slot of slots) {
    const hit = snap.docs.find((docSnap) => {
      const reservation = docSnap.data() as Reservation;
      if (reservation.status === 'Cancelled' || reservation.roomId !== table) return false;
      return expandBookingToHalfHourKeys(reservation.date, reservation.startTime, reservation.endTime)
        .some((item) => item.date === slot.date && item.time === slot.time);
    });
    if (hit) return `警告：${table}號枱在所選時段已有預約，請再選擇時間。`;
    if (holdsByDate.get(slot.date)?.[table].includes(slot.time)) return `警告：${table}號枱在所選時段已有預留，請再選擇時間。`;
  }
  return null;
}

function panelFor(table: HoldTable, panels: { table: HoldTable; start: string; end: string; password: string }[], openPassword: string): TableControl {
  const active = panels.find((panel) => panel.table === table);
  if (!active) return { on: false, start: null, end: null, password: openPassword };
  return { on: true, start: active.start, end: active.end, password: active.password || openPassword };
}

export async function getFacilityControlState(adminUserId: string): Promise<FacilityControlState> {
  const authError = await requireAdmin(adminUserId);
  const empty = { on: false, start: null, end: null, password: '' };
  if (authError) return { success: false, error: authError, table1: empty, table2: empty, allOffPassword: '' };
  const passwords = await readFacilityPasswords();
  const panels = await listActiveHoldPanels();
  return {
    success: true,
    table1: panelFor('1', panels, passwords.openPasswords['1']),
    table2: panelFor('2', panels, passwords.openPasswords['2']),
    allOffPassword: passwords.allOffPassword,
    error: passwords.warning,
  };
}

export async function turnOnHoldTable(adminUserId: string, table: HoldTable, hours: number): Promise<{ success: boolean; error?: string; warning?: string }> {
  const authError = await requireAdmin(adminUserId);
  if (authError) return { success: false, error: authError };
  if (!DURATION_HOURS.has(hours)) return { success: false, error: '請選擇半小時至 12 小時。' };
  if (!db) return { success: false, error: '後端資料庫未連接。' };

  const window = holdWindow(new Date(), hours);
  const slotStart = floorHalfHour(window.startHm);
  const slots = expandBookingToHalfHourKeys(window.startDate, slotStart, window.endHm);
  if (slots.length === 0) return { success: false, error: '找不到可開啟的時段。' };
  const conflict = await rangeConflict(table, slots);
  if (conflict) return { success: false, error: conflict };

  const dates = [...new Set(slots.map((slot) => slot.date))];
  const added = await applyBlockedSlotChanges(adminUserId, dates.map((date) => ({
    date,
    toAdd: slots.filter((slot) => slot.date === date).map((slot) => ({ time: slot.time, table })),
    toRemove: [],
  })));
  if (!added.success) return { success: false, error: added.error || '無法開啟預留。' };

  if (window.startHm !== slotStart) {
    const ref = db.collection(BLOCKED_SLOTS_COLLECTION).doc(window.startDate);
    const snap = await ref.get();
    const starts = parseHoldExactStartsFromDoc(snap.data() as Record<string, unknown> | undefined);
    starts[table][slotStart] = window.startHm;
    await ref.set({ holdExactStarts: starts }, { merge: true });
  }

  const regenerated = await regenerateFacilityPasswords();
  return { success: true, warning: added.calendarWarning ?? regenerated.warning };
}

async function shutTable(adminUserId: string, table: HoldTable, now: Date): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const closed = await closeActiveHoldForAdmin(adminUserId, table, now);
  if (closed.status === 'failed') return { ok: false, error: closed.error || '無法關閉預留。' };
  const calendar = await endActiveHoldCalendarEvents(table, now);
  if (closed.status === 'ok' || calendar.ended > 0) {
    return { ok: true, warning: closed.status === 'ok' ? closed.calendarWarning ?? calendar.error : calendar.error };
  }
  if (calendar.error) return { ok: false, error: calendar.error };
  return { ok: false, error: closed.status === 'not-started' ? '此時段尚未開始。' : '此時段已結束。' };
}

export async function turnOffHoldTable(adminUserId: string, table: HoldTable): Promise<{ success: boolean; error?: string; warning?: string }> {
  const result = await shutTable(adminUserId, table, new Date());
  if (!result.ok && result.error !== '此時段已結束。' && result.error !== '此時段尚未開始。') {
    return { success: false, error: result.error };
  }
  if (!result.ok) return { success: false, error: result.error };
  const regenerated = await regenerateFacilityPasswords();
  return { success: true, warning: result.warning ?? regenerated.warning };
}

export async function turnOffAllHolds(adminUserId: string): Promise<{ success: boolean; error?: string; warning?: string }> {
  const authError = await requireAdmin(adminUserId);
  if (authError) return { success: false, error: authError };
  const first = await shutTable(adminUserId, '1', new Date());
  if (!first.ok && first.error !== '此時段已結束。' && first.error !== '此時段尚未開始。') {
    return { success: false, error: first.error || '枱號1未能關閉。' };
  }
  await new Promise((resolve) => setTimeout(resolve, ALL_OFF_GAP_MS));
  const second = await shutTable(adminUserId, '2', new Date());
  if (!second.ok && second.error !== '此時段已結束。' && second.error !== '此時段尚未開始。') {
    return { success: false, error: second.error || '枱號1已關閉，枱號2未能關閉。', warning: first.warning };
  }
  if (!first.ok && !second.ok) return { success: false, error: '此時段已結束。' };
  const regenerated = await regenerateFacilityPasswords();
  const warning = [first.warning, second.warning, regenerated.warning].filter(Boolean).join(' ');
  return { success: true, warning: warning || undefined };
}
