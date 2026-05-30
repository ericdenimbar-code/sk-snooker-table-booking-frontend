'use client';

import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { BLOCKED_SLOTS_COLLECTION, dateToHktYmd } from '@/lib/blocked-slots';
import { getBlockedSlotsForDate } from '@/app/(main)/new-reservation/actions';

function toSlotSet(slots: string[] | undefined): Set<string> {
  return new Set(Array.isArray(slots) ? slots : []);
}

/**
 * Loads blocked slots for the selected date from Firestore.
 * - Server action fetch on mount/date change (persistence across navigation)
 * - onSnapshot after Firebase Auth is ready (real-time sync for admin + users)
 */
export function useBlockedSlotsSnapshot(
  selectedDate: Date | undefined,
  initialSlots: string[] = [],
): Set<string> {
  const [blockedSlots, setBlockedSlots] = useState<Set<string>>(() => toSlotSet(initialSlots));
  const prevDateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedDate) {
      setBlockedSlots(new Set());
      prevDateRef.current = null;
      return;
    }

    const dateStr = dateToHktYmd(selectedDate);
    let snapshotUnsub: (() => void) | undefined;
    let cancelled = false;

    if (prevDateRef.current !== null && prevDateRef.current !== dateStr) {
      setBlockedSlots(new Set());
    }
    prevDateRef.current = dateStr;

    void getBlockedSlotsForDate(dateStr).then((result) => {
      if (!cancelled && result.success) {
        setBlockedSlots(toSlotSet(result.slots));
      }
    });

    const authUnsub = onAuthStateChanged(auth, async (firebaseUser) => {
      snapshotUnsub?.();
      snapshotUnsub = undefined;

      if (!firebaseUser) {
        return;
      }

      try {
        await firebaseUser.getIdToken();
      } catch (err) {
        console.warn('[blockedSlots] getIdToken failed', err);
        return;
      }

      if (cancelled) return;

      const docRef = doc(db, BLOCKED_SLOTS_COLLECTION, dateStr);
      snapshotUnsub = onSnapshot(
        docRef,
        (snap) => {
          if (cancelled) return;
          const slots = snap.exists() ? snap.data()?.slots : [];
          setBlockedSlots(toSlotSet(Array.isArray(slots) ? slots : undefined));
        },
        (error) => {
          console.error('[blockedSlots] onSnapshot error', error);
        },
      );
    });

    return () => {
      cancelled = true;
      authUnsub();
      snapshotUnsub?.();
    };
  }, [selectedDate]);

  return blockedSlots;
}
