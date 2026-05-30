'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { BLOCKED_SLOTS_COLLECTION, dateToHktYmd } from '@/lib/blocked-slots';
import { getBlockedSlotsForDate } from '@/app/(main)/new-reservation/actions';

/** Server poll when Firestore listener is slow or unavailable */
const BLOCKED_SLOTS_POLL_MS = 10_000;

function toSlotSet(slots: string[] | undefined): Set<string> {
  return new Set(Array.isArray(slots) ? slots : []);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
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
      const next = toSlotSet(result.slots);
      setDbBlockedSlots((prev) => (setsEqual(prev, next) ? prev : next));
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
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    if (prevDateRef.current !== null && prevDateRef.current !== dateStr) {
      setDbBlockedSlots(new Set());
    }
    prevDateRef.current = dateStr;

    const applySlotsFromFirestore = (slots: unknown) => {
      if (cancelled) return;
      const next = toSlotSet(Array.isArray(slots) ? (slots as string[]) : undefined);
      setDbBlockedSlots((prev) => (setsEqual(prev, next) ? prev : next));
    };

    // Immediate server fetch — works even without Firebase Auth
    void refetchBlockedSlots();

    const docRef = doc(db, BLOCKED_SLOTS_COLLECTION, dateStr);
    unsubscribeSnapshot = onSnapshot(
      docRef,
      (snap) => {
        const slots = snap.exists() ? snap.data()?.slots : [];
        applySlotsFromFirestore(slots);
      },
      (error) => {
        console.error('[blockedSlots] onSnapshot error', error);
        void refetchBlockedSlots();
      },
    );

    pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refetchBlockedSlots();
      }
    }, BLOCKED_SLOTS_POLL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refetchBlockedSlots();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      unsubscribeSnapshot?.();
      if (pollInterval) clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
