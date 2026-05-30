'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { BLOCKED_SLOTS_COLLECTION, dateToHktYmd } from '@/lib/blocked-slots';
import { getBlockedSlotsForDate } from '@/app/(main)/new-reservation/actions';

function toSlotSet(slots: string[] | undefined): Set<string> {
  return new Set(Array.isArray(slots) ? slots : []);
}

export type BlockedSlotsSnapshot = {
  dbBlockedSlots: Set<string>;
  removeSlotOptimistic: (slot: string) => void;
  addSlotOptimistic: (slot: string) => void;
  addSlotsOptimistic: (slots: string[]) => void;
  refetchBlockedSlots: () => Promise<void>;
};

export function useBlockedSlotsSnapshot(
  selectedDate: Date | undefined,
  initialSlots: string[] = [],
): BlockedSlotsSnapshot {
  const [dbBlockedSlots, setDbBlockedSlots] = useState<Set<string>>(() => toSlotSet(initialSlots));
  const prevDateRef = useRef<string | null>(null);

  const refetchBlockedSlots = useCallback(async () => {
    if (!selectedDate) return;
    const dateStr = dateToHktYmd(selectedDate);
    const result = await getBlockedSlotsForDate(dateStr);
    if (result.success) {
      setDbBlockedSlots(toSlotSet(result.slots));
    }
  }, [selectedDate]);

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

  const addSlotsOptimistic = useCallback((slots: string[]) => {
    setDbBlockedSlots((prev) => new Set([...prev, ...slots]));
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

    // Immediate fetch — don't wait for auth callback
    void refetchBlockedSlots();

    const attachSnapshot = () => {
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

    const tryAttach = async (firebaseUser: NonNullable<typeof auth.currentUser>) => {
      try {
        await firebaseUser.getIdToken();
      } catch (err) {
        console.warn('[blockedSlots] getIdToken failed', err);
        return;
      }
      attachSnapshot();
    };

    if (auth.currentUser) {
      void tryAttach(auth.currentUser);
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = undefined;

      if (!firebaseUser) {
        return;
      }

      void tryAttach(firebaseUser);
    });

    return () => {
      cancelled = true;
      unsubscribeAuth();
      unsubscribeSnapshot?.();
    };
  }, [selectedDate, refetchBlockedSlots]);

  return {
    dbBlockedSlots,
    removeSlotOptimistic,
    addSlotOptimistic,
    addSlotsOptimistic,
    refetchBlockedSlots,
  };
}
