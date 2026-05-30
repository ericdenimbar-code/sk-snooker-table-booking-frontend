import { subHours } from 'date-fns';
import { db } from '@/lib/firebase-admin';
import type { Reservation } from '@/types';
import {
  deleteGoogleCalendarEventsForReservation,
  eventExistsOnCalendar,
  getReservationCalendarTargets,
} from '@/lib/google-calendar';

export type CalendarAuditResult = {
  scanned: number;
  deleted: number;
  errors: string[];
};

/**
 * Hourly audit: remove Google Calendar events for reservations cancelled in the last 24 hours.
 */
export async function auditCancelledReservationsCalendarSync(): Promise<CalendarAuditResult> {
  if (!db) {
    return { scanned: 0, deleted: 0, errors: ['後端資料庫未連接。'] };
  }

  const sinceIso = subHours(new Date(), 24).toISOString();
  const result: CalendarAuditResult = { scanned: 0, deleted: 0, errors: [] };

  try {
    const snapshot = await db
      .collection('reservations')
      .where('status', '==', 'Cancelled')
      .where('cancelledAt', '>=', sinceIso)
      .get();

    for (const docSnap of snapshot.docs) {
      const reservation = docSnap.data() as Reservation;
      result.scanned++;

      const targets = getReservationCalendarTargets(reservation);
      let removedAny = false;

      for (const target of targets) {
        try {
          const exists = await eventExistsOnCalendar(target.calendarId, target.eventId);
          if (!exists) continue;

          await deleteGoogleCalendarEventsForReservation(reservation);
          removedAny = true;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`${reservation.id}@${target.calendarId}: ${msg}`);
        }
      }

      if (removedAny) {
        result.deleted++;
        await docSnap.ref.update({ googleCalendarSyncStatus: 'synced' });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Audit query failed: ${msg}`);
  }

  return result;
}
