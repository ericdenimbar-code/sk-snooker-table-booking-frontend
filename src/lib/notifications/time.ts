import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const HK_TIMEZONE = 'Asia/Hong_Kong';

/** Format a Date for `<input type="datetime-local">` in Hong Kong local time. */
export function dateToHkDatetimeLocalValue(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return formatInTimeZone(date, HK_TIMEZONE, "yyyy-MM-dd'T'HH:mm");
}

/** Parse datetime-local value as Hong Kong local wall time → UTC Date. */
export function hkDatetimeLocalValueToDate(value: string): Date | null {
  if (!value) return null;
  const parsed = fromZonedTime(value, HK_TIMEZONE);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isExpired(endTime: Date | null | undefined, now: Date = new Date()): boolean {
  if (!endTime || Number.isNaN(endTime.getTime())) return true;
  return now.getTime() > endTime.getTime();
}

export function isWithinActiveWindow(
  startTime: Date | null | undefined,
  endTime: Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!startTime || !endTime) return false;
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return false;
  const t = now.getTime();
  return t >= startTime.getTime() && t <= endTime.getTime();
}

/** Whether the notification should render on the client (HK time, ignores expired even if isActive). */
export function shouldShowNotification(block: {
  isActive: boolean;
  startTime: Date | null;
  endTime: Date | null;
}): boolean {
  if (!block.isActive || !block.content.trim()) return false;
  if (isExpired(block.endTime)) return false;
  return isWithinActiveWindow(block.startTime, block.endTime);
}

/** Effective active state for admin UI (expired → treated as inactive). */
export function getEffectiveIsActive(block: {
  isActive: boolean;
  startTime: Date | null;
  endTime: Date | null;
}): boolean {
  if (!block.isActive) return false;
  if (isExpired(block.endTime)) return false;
  return true;
}
