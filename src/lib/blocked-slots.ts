import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { halfHourEndHm } from '@/lib/door-multi-controls';

export const HKT = 'Asia/Hong_Kong';
export const BLOCKED_SLOTS_COLLECTION = 'blockedSlots';

export type HoldTable = '1' | '2';
export type HoldsByTable = Record<HoldTable, string[]>;
export type HoldNotesByTable = Record<HoldTable, Record<string, string>>;

export function emptyHolds(): HoldsByTable {
  return { '1': [], '2': [] };
}

export function emptyHoldNotes(): HoldNotesByTable {
  return { '1': {}, '2': {} };
}

function noteMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const notes: Record<string, string> = {};
  for (const [time, note] of Object.entries(value as Record<string, unknown>)) {
    if (typeof note === 'string' && note.trim()) notes[time] = note.trim();
  }
  return notes;
}

export function parseHoldNotesFromDoc(data: Record<string, unknown> | undefined): HoldNotesByTable {
  const raw = data?.holdNotes;
  if (!raw || typeof raw !== 'object') return emptyHoldNotes();
  const record = raw as Record<string, unknown>;
  return { '1': noteMap(record['1']), '2': noteMap(record['2']) };
}

export function holdNoteLabel(note: string): string {
  const text = note.trim();
  return text ? `（預留： ${text}）` : '預留時段';
}

/** 連續半小時、而且備注相同，才合成一段。 */
export function mergeHoldSlotsWithNotes(
  slots: Iterable<string>,
  notes: Record<string, string>,
): { start: string; end: string; note: string }[] {
  const sorted = [...new Set(slots)].sort();
  const ranges: { start: string; end: string; note: string }[] = [];
  for (const slot of sorted) {
    const note = notes[slot]?.trim() ?? '';
    const end = halfHourEndHm(slot);
    const last = ranges[ranges.length - 1];
    if (last && last.end === slot && last.note === note) last.end = end;
    else ranges.push({ start: slot, end, note });
  }
  return ranges;
}

function slotList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** 舊資料只有單一 slots，那些事件寫在枱號 1 的預留日曆。 */
export function parseHoldsFromDoc(data: Record<string, unknown> | undefined): HoldsByTable {
  const holds = data?.holds;
  if (holds && typeof holds === 'object') {
    const record = holds as Record<string, unknown>;
    if ('1' in record || '2' in record) {
      return { '1': slotList(record['1']), '2': slotList(record['2']) };
    }
  }
  return { '1': slotList(data?.slots), '2': [] };
}

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
