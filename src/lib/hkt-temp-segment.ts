import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const HKT = 'Asia/Hong_Kong';

/** 每日一碼週期（凌晨 03:00 HKT 重設） */
export type DailyKeyPeriod = {
  /** 例如 D-2026-05-20 */
  dayKey: string;
  /** 此「日」的錨定日期（yyyy-MM-dd，HKT） */
  anchorYmd: string;
  validFrom: Date;
  validUntil: Date;
};

/** @deprecated 相容舊名稱；請改用 DailyKeyPeriod / getDailyKeyPeriodForInstant */
export type TempAccessSegment = DailyKeyPeriod & { segmentKey: string };

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
}

function hktWallToUtc(y: number, m0: number, d: number, hh: number, mm: number): Date {
  return fromZonedTime(new Date(y, m0, d, hh, mm, 0, 0), HKT);
}

function dailyBounds(anchorYmd: string): { validFrom: Date; validUntil: Date } {
  const [y, m, d] = ymdParts(anchorYmd);
  return {
    validFrom: hktWallToUtc(y, m - 1, d, 3, 0),
    validUntil: hktWallToUtc(y, m - 1, d + 1, 3, 0),
  };
}

/**
 * 依香港時間瞬間，判定所屬「每日密鑰」日（03:00 起算至翌日 03:00）。
 */
export function getDailyKeyPeriodForInstant(instant: Date): DailyKeyPeriod {
  const ymd = formatInTimeZone(instant, HKT, 'yyyy-MM-dd');
  const hour = Number(formatInTimeZone(instant, HKT, 'H'));

  let anchorYmd = ymd;
  if (hour < 3) {
    const [y, m, d] = ymdParts(ymd);
    const noonUtc = hktWallToUtc(y, m - 1, d, 12, 0);
    anchorYmd = formatInTimeZone(addDays(noonUtc, -1), HKT, 'yyyy-MM-dd');
  }

  const { validFrom, validUntil } = dailyBounds(anchorYmd);
  const dayKey = `D-${anchorYmd}`;
  return { dayKey, anchorYmd, validFrom, validUntil };
}

/** 相容舊 import */
export function getTempAccessSegmentForInstant(instant: Date): TempAccessSegment {
  const p = getDailyKeyPeriodForInstant(instant);
  return { ...p, segmentKey: p.dayKey };
}

export function getTempAccessSegmentForBooking(dateYmd: string, startHm: string): TempAccessSegment {
  const start = getHktBookingStartUtc(dateYmd, startHm);
  return getTempAccessSegmentForInstant(start);
}

/** 管理員所選時段（香港牆上時間，endHm 為區間結束時刻，如 11:00 表示至 11:00 前） */
export function getAdminSlotPeriodHkt(
  dateYmd: string,
  startHm: string,
  endHm: string,
): { validFrom: Date; validUntil: Date } {
  const [y, mo, d] = ymdParts(dateYmd);
  const [sh, sm] = startHm.split(':').map(Number);
  const [eh, em] = endHm.split(':').map(Number);
  const validFrom = hktWallToUtc(y, mo - 1, d, sh, sm ?? 0);
  let validUntil = hktWallToUtc(y, mo - 1, d, eh, em ?? 0);
  if (validUntil <= validFrom) {
    validUntil = hktWallToUtc(y, mo - 1, d + 1, eh, em ?? 0);
  }
  return { validFrom, validUntil };
}

export function getHktBookingStartUtc(dateYmd: string, startHm: string): Date {
  const [y, mo, d] = ymdParts(dateYmd);
  const [hh, mm] = startHm.split(':').map(Number);
  return hktWallToUtc(y, mo - 1, d, hh, mm);
}

export const VVIP_BUFFER_MINUTES = 3;
export const VVIP_ACTIVE_MINUTES = 30;
/** 日曆結束 = 申請當刻 + 緩衝 + 生效分鐘 */
export const VVIP_CALENDAR_TOTAL_MINUTES = VVIP_BUFFER_MINUTES + VVIP_ACTIVE_MINUTES;
