import type { Firestore } from 'firebase-admin/firestore';
import admin from 'firebase-admin';
import type { TokenPurchaseRequest, Reservation } from '@/types';

const ONE_HOUR_MS = 60 * 60 * 1000;
export const AUTO_CANCEL_STALE_REQUEST_NOTE = '未能於限定時間內轉帳（系統自動取消）';

/**
 * Marks requesting token orders older than 1 hour as cancelled (with reservation refund logic).
 * @param userEmail If set, only orders for this user are expired.
 */
export async function expireStaleRequestingOrders(
  db: Firestore,
  options?: { userEmail?: string },
): Promise<number> {
  const snap = await db.collection('tokenRequests').where('status', '==', 'requesting').get();
  const now = Date.now();
  let cancelled = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as TokenPurchaseRequest;
    if (options?.userEmail && data.userEmail !== options.userEmail) {
      continue;
    }
    const requestedAt = new Date(data.requestDate).getTime();
    if (Number.isNaN(requestedAt) || now - requestedAt <= ONE_HOUR_MS) {
      continue;
    }

    const batch = db.batch();
    batch.update(doc.ref, { status: 'cancelled', notes: AUTO_CANCEL_STALE_REQUEST_NOTE });

    if (data.linkedReservationId) {
      const reservationRef = db.collection('reservations').doc(data.linkedReservationId);
      const reservationSnap = await reservationRef.get();
      if (reservationSnap.exists) {
        const reservationData = reservationSnap.data() as Reservation;
        batch.update(reservationRef, { status: 'Cancelled' });
        if (
          reservationData.paymentMethod === 'mixed' &&
          reservationData.amountPaidWithTokens &&
          reservationData.amountPaidWithTokens > 0
        ) {
          const userQuery = await db.collection('users').where('email', '==', data.userEmail).limit(1).get();
          if (!userQuery.empty) {
            const userRef = userQuery.docs[0].ref;
            batch.update(userRef, {
              tokens: admin.firestore.FieldValue.increment(reservationData.amountPaidWithTokens),
            });
          }
        }
      }
    }

    await batch.commit();
    cancelled += 1;
  }

  return cancelled;
}
