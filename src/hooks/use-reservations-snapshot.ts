'use client';

import { useCallback, useEffect, useState } from 'react';
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

export function useReservationsForDate(
  selectedDate: Date | undefined,
  isAdmin: boolean,
  initialReservations: Reservation[] = [],
): { reservations: Reservation[]; refetchReservations: () => Promise<void> } {
  const [reservations, setReservations] = useState<Reservation[]>(initialReservations);

  const refetchReservations = useCallback(async () => {
    if (!selectedDate) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const result = await getReservationsForDateRange(dateStr);
    if (result.success && result.reservations) {
      setReservations(result.reservations);
    }
  }, [selectedDate]);

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

    // Immediate fetch for all users — no auth wait
    void refetchReservations();

    pollInterval = setInterval(() => {
      void refetchReservations();
    }, 15000);

    const attachAdminSnapshot = () => {
      if (cancelled) return;
      unsubscribeSnapshot?.();
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
          void refetchReservations();
        },
      );
    };

    const tryAdminSnapshot = async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser || !isAdmin) return;
      const role = readLocalRoleForUid(firebaseUser.uid);
      if (role?.toLowerCase() !== 'admin') return;

      try {
        await firebaseUser.getIdToken();
      } catch (err) {
        console.warn('[reservations] getIdToken failed', err);
        return;
      }

      attachAdminSnapshot();
    };

    if (auth.currentUser && isAdmin) {
      void tryAdminSnapshot();
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = undefined;

      if (firebaseUser && isAdmin) {
        void tryAdminSnapshot();
      }
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeSnapshot?.();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [selectedDate, isAdmin, refetchReservations]);

  return { reservations, refetchReservations };
}
