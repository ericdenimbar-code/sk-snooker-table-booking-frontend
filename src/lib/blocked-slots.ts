import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const HKT = 'Asia/Hong_Kong';
export const BLOCKED_SLOTS_COLLECTION = 'blockedSlots';

/** 48 half-hour slots from 00:00 to 23:30 */
export function generateHalfHourSlots(): string[] {
  return Array.from({ length: 48 }, (_, i) => {
    const hours = Math.floor(i / 2);
    const minutes = (i % 2) * 30;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  });
}

export function dateToHktYmd(date: Date): string {
  return formatInTimeZone(date, HKT, 'yyyy-MM-dd');
}

export function isHalfHourSlotPastHkt(dateYmd: string, timeHm: string, now = Date.now()): boolean {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = timeHm.split(':').map(Number);
  const slotInst = fromZonedTime(new Date(y, mo - 1, d, hh, mm, 0, 0), HKT);
  return slotInst.getTime() < now;
}

/** Expand a booking range into individual 30-min slot keys (date + time). endTime is exclusive. */
export function expandBookingToHalfHourKeys(
  date: string,
  startTime: string,
  endTime: string,
  timeSlots = generateHalfHourSlots(),
): { date: string; time: string }[] {
  const result: { date: string; time: string }[] = [];
  const startIdx = timeSlots.indexOf(startTime);
  const endIdx = timeSlots.indexOf(endTime);

  if (startIdx === -1) return result;

  if (endIdx > startIdx) {
    for (let i = startIdx; i < endIdx; i++) {
      result.push({ date, time: timeSlots[i] });
    }
  } else if (endIdx !== -1 && endIdx < startIdx) {
    for (let i = startIdx; i < timeSlots.length; i++) {
      result.push({ date, time: timeSlots[i] });
    }
    const nextDate = format(addDays(parseISO(date), 1), 'yyyy-MM-dd');
    for (let i = 0; i < endIdx; i++) {
      result.push({ date: nextDate, time: timeSlots[i] });
    }
  } else if (endIdx === -1 && startIdx >= 0) {
    for (let i = startIdx; i < timeSlots.length; i++) {
      result.push({ date, time: timeSlots[i] });
    }
  }

  return result;
}

export function isValidHalfHourSlot(time: string, timeSlots = generateHalfHourSlots()): boolean {
  return timeSlots.includes(time);
}
