'use client';

import { useEffect, useState } from 'react';
import { format, subDays } from 'date-fns';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { Reservation } from '@/types';
import { getReservationsForDateRange } from '@/app/(main)/new-reservation/actions';

function readLocalRoleForUid(uid: string): string | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; role?: string };
    if (parsed.id !== uid) return null;
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

/**
 * Real-time reservations for the selected date.
 * Admin: onSnapshot on reservations collection.
 * User: server action fetch (Firestore rules only expose own bookings to clients).
 */
export function useReservationsForDate(
  selectedDate: Date | undefined,
  isAdmin: boolean,
  initialReservations: Reservation[] = [],
): Reservation[] {
  const [reservations, setReservations] = useState<Reservation[]>(initialReservations);

  useEffect(() => {
    if (!selectedDate) {
      setReservations([]);
      return;
    }

    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const prevDateStr = format(subDays(selectedDate, 1), 'yyyy-MM-dd');
    let unsubscribeSnapshot: (() => void) | undefined;
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const fetchViaServer = () => {
      void getReservationsForDateRange(dateStr).then((result) => {
        if (!cancelled && result.success && result.reservations) {
          setReservations(result.reservations);
        }
      });
    };

    const attachAdminSnapshot = async (uid: string) => {
      try {
        await auth.currentUser?.getIdToken();
      } catch (err) {
        console.warn('[reservations] getIdToken failed', err);
        fetchViaServer();
        return;
      }

      if (cancelled) return;

      const q = query(
        collection(db, 'reservations'),
        where('date', 'in', [dateStr, prevDateStr]),
      );

      unsubscribeSnapshot = onSnapshot(
        q,
        (snapshot) => {
          if (cancelled) return;
          setReservations(snapshot.docs.map((docSnap) => docSnap.data() as Reservation));
        },
        (error) => {
          console.error('[reservations] onSnapshot error', error);
          fetchViaServer();
        },
      );
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = undefined;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = undefined;
      }

      const role = firebaseUser ? readLocalRoleForUid(firebaseUser.uid) : null;
      const admin = role?.toLowerCase() === 'admin';

      if (firebaseUser && admin && isAdmin) {
        void attachAdminSnapshot(firebaseUser.uid);
        return;
      }

      fetchViaServer();
      pollInterval = setInterval(fetchViaServer, 60000);
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeSnapshot?.();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [selectedDate, isAdmin]);

  return reservations;
}
