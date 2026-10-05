import { formatInTimeZone } from 'date-fns-tz';

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
