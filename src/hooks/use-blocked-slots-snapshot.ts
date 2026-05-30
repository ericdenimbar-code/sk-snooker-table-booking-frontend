'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { BLOCKED_SLOTS_COLLECTION, dateToHktYmd } from '@/lib/blocked-slots';

function toSlotSet(slots: string[] | undefined): Set<string> {
  return new Set(Array.isArray(slots) ? slots : []);
}

export type BlockedSlotsSnapshot = {
  /** Firestore-backed blocked slots for the selected date (real-time via onSnapshot) */
  dbBlockedSlots: Set<string>;
  /** Optimistically remove a slot before Firestore confirms (admin unblock) */
  removeSlotOptimistic: (slot: string) => void;
  /** Roll back optimistic remove when the server action fails */
  addSlotOptimistic: (slot: string) => void;
};

/**
 * Real-time blocked slots for the selected date.
 * Uses onSnapshot on blockedSlots/{date} — no one-time static fetch.
 * SSR initialSlots seed first paint only; live updates come from Firestore.
 */
export function useBlockedSlotsSnapshot(
  selectedDate: Date | undefined,
  initialSlots: string[] = [],
): BlockedSlotsSnapshot {
  const [dbBlockedSlots, setDbBlockedSlots] = useState<Set<string>>(() => toSlotSet(initialSlots));
  const prevDateRef = useRef<string | null>(null);

  const removeSlotOptimistic = useCallback((slot: string) => {
    setDbBlockedSlots((prev) => {
      const next = new Set(prev);
      next.delete(slot);
      return next;
    });
  }, []);

  const addSlotOptimistic = useCallback((slot: string) => {
    setDbBlockedSlots((prev) => new Set([...prev, slot]));
  }, []);

  useEffect(() => {
    if (!selectedDate) {
      setDbBlockedSlots(new Set());
      prevDateRef.current = null;
      return;
    }

    const dateStr = dateToHktYmd(selectedDate);
    let unsubscribeSnapshot: (() => void) | undefined;
    let cancelled = false;

    if (prevDateRef.current !== null && prevDateRef.current !== dateStr) {
      setDbBlockedSlots(new Set());
    }
    prevDateRef.current = dateStr;

    const attachSnapshot = async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser || cancelled) return;

      try {
        await firebaseUser.getIdToken();
      } catch (err) {
        console.warn('[blockedSlots] getIdToken failed', err);
        return;
      }

      if (cancelled) return;

      unsubscribeSnapshot?.();
      const docRef = doc(db, BLOCKED_SLOTS_COLLECTION, dateStr);
      unsubscribeSnapshot = onSnapshot(
        docRef,
        (snap) => {
          if (cancelled) return;
          const slots = snap.exists() ? snap.data()?.slots : [];
          setDbBlockedSlots(toSlotSet(Array.isArray(slots) ? slots : undefined));
        },
        (error) => {
          console.error('[blockedSlots] onSnapshot error', error);
        },
      );
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = undefined;

      if (!firebaseUser) {
        setDbBlockedSlots(new Set());
        return;
      }

      void attachSnapshot();
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeSnapshot?.();
    };
  }, [selectedDate]);

  return { dbBlockedSlots, removeSlotOptimistic, addSlotOptimistic };
}
