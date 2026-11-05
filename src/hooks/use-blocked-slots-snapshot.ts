'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  BLOCKED_SLOTS_COLLECTION,
  dateToHktYmd,
  emptyHolds,
  parseHoldsFromDoc,
  type HoldsByTable,
} from '@/lib/blocked-slots';
import { getBlockedSlotsForDate } from '@/app/(main)/new-reservation/actions';

const BLOCKED_SLOTS_POLL_MS = 10_000;

export type HoldSets = Record<'1' | '2', Set<string>>;

function toHoldSets(holds: HoldsByTable): HoldSets {
  return { '1': new Set(holds['1']), '2': new Set(holds['2']) };
}

function holdsEqual(a: HoldSets, b: HoldSets): boolean {
  return setsEqual(a['1'], b['1']) && setsEqual(a['2'], b['2']);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export type BlockedSlotsSnapshot = {
  holdSets: HoldSets;
  refetchBlockedSlots: () => Promise<void>;
};

export function useBlockedSlotsSnapshot(
  selectedDate: Date | undefined,
  initialHolds: HoldsByTable = emptyHolds(),
): BlockedSlotsSnapshot {
  const [holdSets, setHoldSets] = useState<HoldSets>(() => toHoldSets(initialHolds));
  const prevDateRef = useRef<string | null>(null);

  const applyHolds = useCallback((next: HoldSets) => {
    setHoldSets((prev) => (holdsEqual(prev, next) ? prev : next));
  }, []);

  const refetchBlockedSlots = useCallback(async () => {
    if (!selectedDate) return;
    const dateStr = dateToHktYmd(selectedDate);
    const result = await getBlockedSlotsForDate(dateStr);
    if (result.success && result.holds) {
      applyHolds(toHoldSets(result.holds));
    }
  }, [applyHolds, selectedDate]);

  useEffect(() => {
    if (!selectedDate) {
      setHoldSets(toHoldSets(emptyHolds()));
      prevDateRef.current = null;
      return;
    }

    const dateStr = dateToHktYmd(selectedDate);
    let unsubscribeSnapshot: (() => void) | undefined;
    let pollInterval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    if (prevDateRef.current !== null && prevDateRef.current !== dateStr) {
      setHoldSets(toHoldSets(emptyHolds()));
    }
    prevDateRef.current = dateStr;

    void refetchBlockedSlots();

    const docRef = doc(db, BLOCKED_SLOTS_COLLECTION, dateStr);
    unsubscribeSnapshot = onSnapshot(
      docRef,
      (snap) => {
        if (cancelled) return;
        const holds = parseHoldsFromDoc(snap.exists() ? snap.data() as Record<string, unknown> : undefined);
        applyHolds(toHoldSets(holds));
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
  }, [selectedDate, refetchBlockedSlots, applyHolds]);

  return { holdSets, refetchBlockedSlots };
}
