import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const HKT = 'Asia/Hong_Kong';

export type TempAccessSegment = {
  segmentKey: string;
  /** A: 03:00–15:00 HKT；B: 15:00 當日–翌日 03:00 HKT */
  kind: 'A' | 'B';
  /** 此 B 段所屬「起始日」或 A 段當日（yyyy-MM-dd，HKT） */
  anchorYmd: string;
  validFrom: Date;
  validUntil: Date;
};

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
}

function hktWallToUtc(y: number, m0: number, d: number, hh: number, mm: number): Date {
  return fromZonedTime(new Date(y, m0, d, hh, mm, 0, 0), HKT);
}

function boundsSegmentA(anchorYmd: string): { validFrom: Date; validUntil: Date } {
  const [y, m, d] = ymdParts(anchorYmd);
  return {
    validFrom: hktWallToUtc(y, m - 1, d, 3, 0),
    validUntil: hktWallToUtc(y, m - 1, d, 15, 0),
  };
}

function boundsSegmentB(anchorYmd: string): { validFrom: Date; validUntil: Date } {
  const [y, m, d] = ymdParts(anchorYmd);
  const start = hktWallToUtc(y, m - 1, d, 15, 0);
  const end = hktWallToUtc(y, m - 1, d + 1, 3, 0);
  return { validFrom: start, validUntil: end };
}

/**
 * 依「香港時間」下某個瞬間，判定所屬 A/B 段與區間邊界。
 */
export function getTempAccessSegmentForInstant(instant: Date): TempAccessSegment {
  const ymd = formatInTimeZone(instant, HKT, 'yyyy-MM-dd');
  const hour = Number(formatInTimeZone(instant, HKT, 'H'));

  if (hour >= 3 && hour < 15) {
    const { validFrom, validUntil } = boundsSegmentA(ymd);
    return { segmentKey: `A-${ymd}`, kind: 'A', anchorYmd: ymd, validFrom, validUntil };
  }

  let anchorYmd = ymd;
  if (hour < 3) {
    const [y, m, d] = ymdParts(ymd);
    const noonUtc = hktWallToUtc(y, m - 1, d, 12, 0);
    anchorYmd = formatInTimeZone(addDays(noonUtc, -1), HKT, 'yyyy-MM-dd');
  }

  const { validFrom, validUntil } = boundsSegmentB(anchorYmd);
  return { segmentKey: `B-${anchorYmd}`, kind: 'B', anchorYmd, validFrom, validUntil };
}

/**
 * 使用者選擇的預約日與開始時間（視為香港本地牆上時間）所屬時段。
 */
export function getTempAccessSegmentForBooking(dateYmd: string, startHm: string): TempAccessSegment {
  const [y, mo, d] = ymdParts(dateYmd);
  const [hh, mm] = startHm.split(':').map(Number);
  const instant = hktWallToUtc(y, mo - 1, d, hh, mm);
  return getTempAccessSegmentForInstant(instant);
}

/** 預約日與開始時間（香港牆上時間）對應的 UTC 瞬間 */
export function getHktBookingStartUtc(dateYmd: string, startHm: string): Date {
  const [y, mo, d] = ymdParts(dateYmd);
  const [hh, mm] = startHm.split(':').map(Number);
  return hktWallToUtc(y, mo - 1, d, hh, mm);
}
