import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const HKT = 'Asia/Hong_Kong';

/** 香港時間當下的「一日內分鐘數」0–1439。 */
export function minutesInHongKong(date: Date): number {
  const hm = formatInTimeZone(date, HKT, 'HH:mm');
  const [hours, minutes] = hm.split(':').map(Number);
  return hours * 60 + minutes;
}

export function parseHm(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * 以香港時間的鐘面比較。結束早於開始代表跨日（例如 22:00–04:00）。
 * 開始與結束相同則視為無效時段。起迄分鐘都算在時段內。
 */
export function isWithinShutdownWindow(now: Date, startTime: string, endTime: string): boolean {
  const nowMinutes = minutesInHongKong(now);
  const start = parseHm(startTime);
  const end = parseHm(endTime);
  if (start === null || end === null || start === end) return false;
  if (start < end) return nowMinutes >= start && nowMinutes <= end;
  return nowMinutes >= start || nowMinutes <= end;
}

export function shutdownWindowCrossesMidnight(startTime: string, endTime: string): boolean {
  const start = parseHm(startTime);
  const end = parseHm(endTime);
  if (start === null || end === null) return false;
  return end < start;
}

export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 以按下確定當日的香港日期，算出這一次時段的絕對開始與結束。 */
export function shutdownWindowBounds(startDate: string, startTime: string, endTime: string): {
  from: Date;
  until: Date;
  endDate: string;
} | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  if (parseHm(startTime) === null || parseHm(endTime) === null || startTime === endTime) return null;
  const endDate = shutdownWindowCrossesMidnight(startTime, endTime) ? addCalendarDays(startDate, 1) : startDate;
  const from = fromZonedTime(`${startDate}T${startTime}:00`, HKT);
  const until = fromZonedTime(`${endDate}T${endTime}:00`, HKT);
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until.getTime() <= from.getTime()) return null;
  return { from, until, endDate };
}

export function formatShutdownWindowLabel(startDate: string, startTime: string, endDate: string, endTime: string): string {
  if (startDate === endDate) return `${startDate} ${startTime} 至 ${endTime}`;
  return `${startDate} ${startTime} 至 ${endDate} ${endTime}`;
}

/** 結束分鐘整分鐘都算在時段內。 */
export function isWithinAbsoluteShutdownWindow(now: Date, fromMs: number, untilMs: number): boolean {
  const time = now.getTime();
  return time >= fromMs && time < untilMs + 60_000;
}
