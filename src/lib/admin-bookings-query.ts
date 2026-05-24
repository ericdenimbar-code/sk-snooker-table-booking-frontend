import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Reservation, TemporaryAccess } from '@/types';
import { getAdminSlotPeriodHkt, getHktBookingStartUtc } from '@/lib/hkt-temp-segment';

export const HKT = 'Asia/Hong_Kong';

export type AdminDayWindow = {
  dayYmd: string;
  /** 當日 00:00 HKT（毫秒） */
  windowStartMs: number;
  /** 翌日 04:00 HKT（毫秒） */
  windowEndMs: number;
  /** Firestore `date` 欄位查詢用（含跨午夜前後日） */
  queryDates: [string, string, string];
};

export function isSameHktDay(a: Date, b: Date): boolean {
  return formatInTimeZone(a, HKT, 'yyyy-MM-dd') === formatInTimeZone(b, HKT, 'yyyy-MM-dd');
}

/** 管理員日曆單日視窗：endTime ≥ 當日 00:00 且 startTime ≤ 翌日 04:00（HKT） */
export function getAdminDayWindow(dayYmd: string): AdminDayWindow {
  const [y, mo, d] = dayYmd.split('-').map(Number);
  const anchor = new Date(y, mo - 1, d);
  const prevYmd = formatInTimeZone(addDays(anchor, -1), HKT, 'yyyy-MM-dd');
  const nextYmd = formatInTimeZone(addDays(anchor, 1), HKT, 'yyyy-MM-dd');

  const windowStartMs = getHktBookingStartUtc(dayYmd, '00:00').getTime();
  const windowEndMs = getHktBookingStartUtc(nextYmd, '04:00').getTime();

  return {
    dayYmd,
    windowStartMs,
    windowEndMs,
    queryDates: [prevYmd, dayYmd, nextYmd],
  };
}

export function reservationStartMs(r: Reservation): number {
  return getHktBookingStartUtc(r.date, r.startTime).getTime();
}

export function reservationEndMs(r: Reservation): number {
  return getAdminSlotPeriodHkt(r.date, r.startTime, r.endTime).validUntil.getTime();
}

export function reservationInAdminWindow(r: Reservation, window: AdminDayWindow): boolean {
  if (!r.date || !r.startTime || !r.endTime) return false;
  try {
    const startMs = reservationStartMs(r);
    const endMs = reservationEndMs(r);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
    return endMs >= window.windowStartMs && startMs <= window.windowEndMs;
  } catch {
    return false;
  }
}

export function sortReservationsByStartDesc(a: Reservation, b: Reservation): number {
  return reservationStartMs(b) - reservationStartMs(a);
}

export function tempAccessStartMs(t: TemporaryAccess): number {
  const from = t.effectiveFrom ?? t.validFrom;
  return new Date(from).getTime();
}

export function tempAccessEndMs(t: TemporaryAccess): number {
  const until = t.calendarUntil ?? t.validUntil;
  return new Date(until).getTime();
}

export function tempAccessInAdminWindow(t: TemporaryAccess, window: AdminDayWindow): boolean {
  if (t.status !== 'active') return false;
  const startMs = tempAccessStartMs(t);
  const endMs = tempAccessEndMs(t);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return endMs >= window.windowStartMs && startMs <= window.windowEndMs;
}

/** Firestore `validUntil`（ISO 字串）查詢下界 */
export function adminTempAccessQueryFromIso(window: AdminDayWindow): string {
  return new Date(window.windowStartMs).toISOString();
}
