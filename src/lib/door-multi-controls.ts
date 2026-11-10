/**
 * 預留日曆依枱號分開：枱號 1 用 Holdtable1，枱號 2 用 HoldTable2。
 * 標題由呼叫端傳入，預留時段本身不用 MEETING。
 */
export const DOOR_MULTI_CONTROLS = {
  /** 預留時段。開始與結束都用所選半小時的正點。 */
  reservedSlot: {
    key: 'reserved-slot',
    title: '預留時段',
  },
  /** 離場關閉所有器材。標題只屬於這項控制，不套用到其他多重日曆項目。 */
  closeAll: {
    key: 'close-all',
    title: 'CLOSEALL',
  },
} as const;

export type DoorMultiEventRecord = {
  actionKey: string;
  start: string;
  end: string;
  eventKey: string;
};

export function halfHourEndHm(startHm: string): string {
  const [h, m] = startHm.split(':').map(Number);
  const total = h * 60 + m + 30;
  const eh = Math.floor(total / 60) % 24;
  const em = total % 60;
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
}

/** 由開始時刻走到結束時刻（不含結束），每步 30 分鐘。 */
export function expandHalfHoursUntil(startHm: string, endHm: string): string[] {
  const slots: string[] = [];
  let cursor = startHm;
  let guard = 0;
  while (cursor !== endHm && guard < 48) {
    slots.push(cursor);
    cursor = halfHourEndHm(cursor);
    guard += 1;
  }
  return slots;
}

export function mergeHalfHourSlots(slots: Iterable<string>): { start: string; end: string }[] {
  const sorted = [...new Set(slots)].sort();
  const ranges: { start: string; end: string }[] = [];
  for (const slot of sorted) {
    const end = halfHourEndHm(slot);
    const last = ranges[ranges.length - 1];
    if (last && last.end === slot) last.end = end;
    else ranges.push({ start: slot, end });
  }
  return ranges;
}

export function eventKeyForDoorMultiRange(actionKey: string, date: string, start: string, end: string): string {
  return `door-multi:${actionKey}:${date}:${start}:${end}`;
}

export function parseDoorMultiEvents(value: unknown): DoorMultiEventRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Partial<DoorMultiEventRecord>;
    if (!record.actionKey || !record.start || !record.end || !record.eventKey) return [];
    return [{
      actionKey: record.actionKey,
      start: record.start,
      end: record.end,
      eventKey: record.eventKey,
    }];
  });
}

/** 依既有日曆紀錄加減本次半小時槽，合併成連續時段。 */
export function reconcileDoorMultiCoverage(
  existing: DoorMultiEventRecord[],
  actionKey: string,
  date: string,
  toAdd: Iterable<string>,
  toRemove: Iterable<string>,
  passwords?: Record<string, string>,
): { desired: DoorMultiEventRecord[]; toCreate: DoorMultiEventRecord[]; toDelete: DoorMultiEventRecord[] } {
  const mine = existing.filter((event) => event.actionKey === actionKey);
  const covered = new Set<string>();
  for (const event of mine) {
    for (const slot of expandHalfHoursUntil(event.start, event.end)) covered.add(slot);
  }
  for (const slot of toAdd) covered.add(slot);
  for (const slot of toRemove) covered.delete(slot);

  const byPassword = new Map<string, string[]>();
  for (const slot of covered) {
    const password = passwords?.[slot] ?? '';
    const group = byPassword.get(password) ?? [];
    group.push(slot);
    byPassword.set(password, group);
  }
  const desired = [...byPassword.entries()].flatMap(([password, slots]) =>
    mergeHalfHourSlots(slots).map((range) => ({
      actionKey,
      start: range.start,
      end: range.end,
      eventKey: password
        ? `${eventKeyForDoorMultiRange(actionKey, date, range.start, range.end)}:${password}`
        : eventKeyForDoorMultiRange(actionKey, date, range.start, range.end),
    })),
  );
  const desiredKeys = new Set(desired.map((event) => event.eventKey));
  const existingKeys = new Set(mine.map((event) => event.eventKey));
  return {
    desired,
    toCreate: desired.filter((event) => !existingKeys.has(event.eventKey)),
    toDelete: mine.filter((event) => !desiredKeys.has(event.eventKey)),
  };
}
