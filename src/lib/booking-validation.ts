import { format, subDays } from 'date-fns';
import type { Firestore } from 'firebase-admin/firestore';
import type { Reservation } from '@/types';
import {
  BLOCKED_SLOTS_COLLECTION,
  expandBookingToHalfHourKeys,
  generateHalfHourSlots,
} from '@/lib/blocked-slots';

export const BOOKING_CONFLICT_MSG =
  '抱歉，該時段剛剛已被預訂或封鎖，請重新整理頁面。';

type FirestoreDb = Firestore;

function slotOverlapsReservation(
  dateStr: string,
  time: string,
  res: Reservation,
  timeSlots: string[],
  prevDateStr: string,
): boolean {
  if (res.status === 'Cancelled') return false;

  const startTimeIndex = timeSlots.indexOf(res.startTime);
  const endTimeIndex = timeSlots.indexOf(res.endTime);
  const currentTimeIndex = timeSlots.indexOf(time);

  if (startTimeIndex === -1 || currentTimeIndex === -1) return false;

  if (endTimeIndex > startTimeIndex) {
    return res.date === dateStr && currentTimeIndex >= startTimeIndex && currentTimeIndex < endTimeIndex;
  }
  if (endTimeIndex < startTimeIndex) {
    if (res.date === prevDateStr && currentTimeIndex < endTimeIndex) return true;
    if (res.date === dateStr && currentTimeIndex >= startTimeIndex) return true;
  }
  return false;
}

function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && endA > startB;
}

async function getBlockedSlotsSetForDate(
  db: FirestoreDb,
  date: string,
): Promise<Set<string>> {
  const docSnap = await db.collection(BLOCKED_SLOTS_COLLECTION).doc(date).get();
  if (!docSnap.exists) return new Set();
  const slots = docSnap.data()?.slots;
  return new Set(Array.isArray(slots) ? slots : []);
}

/**
 * Final server-side gate before charging / writing a reservation.
 * Checks blockedSlots and room / capacity conflicts.
 */
export async function assertBookingAllowed(
  db: FirestoreDb,
  roomId: string,
  date: string,
  startTime: string,
  endTime: string,
): Promise<string | null> {
  const keys = expandBookingToHalfHourKeys(date, startTime, endTime);
  if (keys.length === 0) return null;

  const datesToCheck = [...new Set(keys.map((k) => k.date))];
  const blockedByDate = new Map<string, Set<string>>();
  await Promise.all(
    datesToCheck.map(async (d) => {
      blockedByDate.set(d, await getBlockedSlotsSetForDate(db, d));
    }),
  );

  for (const { date: slotDate, time } of keys) {
    if (blockedByDate.get(slotDate)?.has(time)) {
      return BOOKING_CONFLICT_MSG;
    }
  }

  const timeSlots = generateHalfHourSlots();
  const queryDates = [...new Set(keys.flatMap((k) => [k.date, format(subDays(new Date(`${k.date}T12:00:00`), 1), 'yyyy-MM-dd')]))];

  const snapshots = await Promise.all(
    queryDates.map((d) => db.collection('reservations').where('date', '==', d).get()),
  );

  const allReservations = snapshots.flatMap((snap) =>
    snap.docs.map((doc) => doc.data() as Reservation),
  );

  const roomConflict = allReservations.some(
    (res) =>
      res.roomId === roomId &&
      res.status !== 'Cancelled' &&
      res.date === date &&
      timesOverlap(res.startTime, res.endTime, startTime, endTime),
  );
  if (roomConflict) return BOOKING_CONFLICT_MSG;

  for (const { date: slotDate, time } of keys) {
    const prevDateStr = format(subDays(new Date(`${slotDate}T12:00:00`), 1), 'yyyy-MM-dd');
    let count = 0;
    for (const res of allReservations) {
      if (slotOverlapsReservation(slotDate, time, res, timeSlots, prevDateStr)) {
        count++;
      }
    }
    if (count >= 2) return BOOKING_CONFLICT_MSG;
  }

  return null;
}
