import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import admin from 'firebase-admin';
import { db } from '@/lib/firebase-admin';
import { formatInTimeZone } from 'date-fns-tz';
import { createFacilityCloseAllEvent } from '@/lib/google-calendar';
import {
  formatShutdownWindowLabel,
  isWithinAbsoluteShutdownWindow,
  parseHm,
  shutdownWindowBounds,
} from '@/lib/facility-shutdown-window';

const HKT = 'Asia/Hong_Kong';
const COLLECTION = 'facilityShutdown';
const LOG_COLLECTION = 'facilityShutdownLogs';
const DOC_ID = 'current';
const TICKET_TTL_MS = 3 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const TRIGGER_LOCK_MS = 60 * 1000;

export type FacilityShutdownPublicStatus = 'ok' | 'closed' | 'invalid' | 'busy' | 'failed';

export type FacilityShutdownLogView = {
  id: string;
  triggeredAtLabel: string;
  windowLabel: string;
  passcode: string;
};

export type FacilityShutdownSettingsView = {
  passcode: string | null;
  startTime: string | null;
  endTime: string | null;
  startDate: string | null;
  endDate: string | null;
  windowLabel: string | null;
  effectiveUntilIso: string | null;
  isActive: boolean;
  logs: FacilityShutdownLogView[];
};

type ShutdownDoc = {
  passcode: string | null;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  effectiveFromMs: number | null;
  effectiveUntilMs: number | null;
  ticketHash: string | null;
  ticketExpiresAtMs: number | null;
  failedAttempts: number;
  lockedUntilMs: number | null;
  triggerLockUntilMs: number | null;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  return sameSecret(sha256(a), sha256(b));
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function millisOf(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (typeof value === 'object' && value !== null && 'toMillis' in value && typeof (value as { toMillis: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function emptyDoc(): ShutdownDoc {
  return {
    passcode: null,
    startTime: null,
    endTime: null,
    isActive: false,
    startDate: null,
    endDate: null,
    effectiveFromMs: null,
    effectiveUntilMs: null,
    ticketHash: null,
    ticketExpiresAtMs: null,
    failedAttempts: 0,
    lockedUntilMs: null,
    triggerLockUntilMs: null,
  };
}

function parseDoc(data: FirebaseFirestore.DocumentData | undefined): ShutdownDoc {
  if (!data) return emptyDoc();
  const passcode = typeof data.passcode === 'string' && /^\d{4}$/.test(data.passcode) ? data.passcode : null;
  const startTime = typeof data.startTime === 'string' && parseHm(data.startTime) !== null ? data.startTime : null;
  const endTime = typeof data.endTime === 'string' && parseHm(data.endTime) !== null ? data.endTime : null;
  const startDate = typeof data.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.startDate) ? data.startDate : null;
  const endDate = typeof data.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.endDate) ? data.endDate : null;
  return {
    passcode,
    startTime,
    endTime,
    isActive: data.isActive === true,
    startDate,
    endDate,
    effectiveFromMs: millisOf(data.effectiveFrom),
    effectiveUntilMs: millisOf(data.effectiveUntil),
    ticketHash: typeof data.ticketHash === 'string' ? data.ticketHash : null,
    ticketExpiresAtMs: millisOf(data.ticketExpiresAt),
    failedAttempts: typeof data.failedAttempts === 'number' ? data.failedAttempts : 0,
    lockedUntilMs: millisOf(data.lockedUntil),
    triggerLockUntilMs: millisOf(data.triggerLockUntil),
  };
}

function docRef() {
  if (!db) return null;
  return db.collection(COLLECTION).doc(DOC_ID);
}

function windowIsConfigured(doc: ShutdownDoc): boolean {
  return doc.isActive
    && !!doc.passcode
    && !!doc.startTime
    && !!doc.endTime
    && !!doc.startDate
    && !!doc.endDate
    && doc.effectiveFromMs !== null
    && doc.effectiveUntilMs !== null;
}

function windowLabelOf(doc: ShutdownDoc): string | null {
  if (!doc.startDate || !doc.endDate || !doc.startTime || !doc.endTime) return null;
  return formatShutdownWindowLabel(doc.startDate, doc.startTime, doc.endDate, doc.endTime);
}

function windowHasEnded(doc: ShutdownDoc, now = Date.now()): boolean {
  if (doc.effectiveUntilMs === null) return false;
  return now >= doc.effectiveUntilMs + 60_000;
}

function clearedWindow(doc: ShutdownDoc): ShutdownDoc {
  return {
    ...doc,
    passcode: null,
    startTime: null,
    endTime: null,
    startDate: null,
    endDate: null,
    effectiveFromMs: null,
    effectiveUntilMs: null,
    isActive: false,
    ticketHash: null,
    ticketExpiresAtMs: null,
    triggerLockUntilMs: null,
  };
}

/** 時段已過、且沒有人按下關閉時，清掉這次設定。不寫入觸發紀錄。 */
async function clearExpiredWindow(doc: ShutdownDoc): Promise<ShutdownDoc> {
  const ref = docRef();
  if (!ref || !windowIsConfigured(doc) || !windowHasEnded(doc)) return doc;
  if (doc.triggerLockUntilMs && doc.triggerLockUntilMs > Date.now()) return doc;
  await ref.set({
    passcode: null,
    startTime: null,
    endTime: null,
    startDate: null,
    endDate: null,
    effectiveFrom: null,
    effectiveUntil: null,
    isActive: false,
    ticketHash: null,
    ticketExpiresAt: null,
    failedAttempts: 0,
    lockedUntil: null,
    triggerLockUntil: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return clearedWindow(doc);
}

function toView(doc: ShutdownDoc, logs: FacilityShutdownLogView[]): FacilityShutdownSettingsView {
  const active = windowIsConfigured(doc) && !windowHasEnded(doc);
  return {
    passcode: active ? doc.passcode : null,
    startTime: active ? doc.startTime : null,
    endTime: active ? doc.endTime : null,
    startDate: active ? doc.startDate : null,
    endDate: active ? doc.endDate : null,
    windowLabel: active ? windowLabelOf(doc) : null,
    effectiveUntilIso: active && doc.effectiveUntilMs ? new Date(doc.effectiveUntilMs).toISOString() : null,
    isActive: active,
    logs,
  };
}

function isOpenNow(doc: ShutdownDoc, now = new Date()): boolean {
  if (!windowIsConfigured(doc) || doc.effectiveFromMs === null || doc.effectiveUntilMs === null) return false;
  return isWithinAbsoluteShutdownWindow(now, doc.effectiveFromMs, doc.effectiveUntilMs);
}

async function assertAdmin(adminUserId: string): Promise<string | null> {
  if (!db) return '後端資料庫未連接。';
  if (!adminUserId) return '權限不足。';
  const adminDoc = await db.collection('users').doc(adminUserId).get();
  const role = String(adminDoc.data()?.role ?? '').toLowerCase();
  if (!adminDoc.exists || role !== 'admin') return '權限不足。';
  return null;
}

export function randomFacilityPasscode(): string {
  return String(randomInt(0, 10000)).padStart(4, '0');
}

async function readLogs(): Promise<FacilityShutdownLogView[]> {
  if (!db) return [];
  const snap = await db.collection(LOG_COLLECTION).orderBy('triggeredAt', 'desc').limit(200).get();
  return snap.docs.flatMap((item) => {
    const data = item.data();
    const triggeredAtMs = millisOf(data.triggeredAt);
    const startDate = typeof data.startDate === 'string' ? data.startDate : '';
    const endDate = typeof data.endDate === 'string' ? data.endDate : '';
    const startTime = typeof data.startTime === 'string' ? data.startTime : '';
    const endTime = typeof data.endTime === 'string' ? data.endTime : '';
    const passcode = typeof data.passcode === 'string' ? data.passcode : '';
    if (!triggeredAtMs) return [];
    const windowLabel = startDate && startTime && endTime
      ? formatShutdownWindowLabel(startDate, startTime, endDate || startDate, endTime)
      : '—';
    return [{
      id: item.id,
      triggeredAtLabel: formatInTimeZone(new Date(triggeredAtMs), HKT, 'yyyy-MM-dd HH:mm:ss'),
      windowLabel,
      passcode: passcode || '—',
    }];
  });
}

export async function getFacilityShutdownSettingsForAdmin(adminUserId: string): Promise<
  { success: true; settings: FacilityShutdownSettingsView } | { success: false; error: string }
> {
  const authError = await assertAdmin(adminUserId);
  if (authError) return { success: false, error: authError };
  const ref = docRef();
  if (!ref || !db) return { success: false, error: '後端資料庫未連接。' };
  const snap = await ref.get();
  await backfillLegacyTrigger(snap.data());
  const current = await clearExpiredWindow(parseDoc(snap.data()));
  const logs = await readLogs();
  return { success: true, settings: toView(current, logs) };
}

async function backfillLegacyTrigger(data: FirebaseFirestore.DocumentData | undefined) {
  if (!db || !data) return;
  const legacyMs = millisOf(data.triggeredAt);
  if (!legacyMs) return;
  const legacyRef = db.collection(LOG_COLLECTION).doc(`legacy-${legacyMs}`);
  const existing = await legacyRef.get();
  if (existing.exists) return;
  await legacyRef.set({
    triggeredAt: admin.firestore.Timestamp.fromMillis(legacyMs),
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    passcode: '',
  });
}

export async function saveFacilityShutdownSettings(params: {
  adminUserId: string;
  passcode: string;
  startTime: string;
  endTime: string;
}): Promise<{ success: true; settings: FacilityShutdownSettingsView } | { success: false; error: string }> {
  const authError = await assertAdmin(params.adminUserId);
  if (authError) return { success: false, error: authError };
  if (!db) return { success: false, error: '後端資料庫未連接。' };
  if (!/^\d{4}$/.test(params.passcode)) return { success: false, error: '密碼必須是 4 位數字。' };
  const start = parseHm(params.startTime);
  const end = parseHm(params.endTime);
  if (start === null || end === null) return { success: false, error: '時段格式不正確。' };
  if (start === end) return { success: false, error: '開始與結束時間不能相同。' };

  const startDate = formatInTimeZone(new Date(), HKT, 'yyyy-MM-dd');
  const bounds = shutdownWindowBounds(startDate, params.startTime, params.endTime);
  if (!bounds) return { success: false, error: '時段格式不正確。' };
  if (bounds.until.getTime() + 60_000 <= Date.now()) {
    return { success: false, error: '此時段已經結束，請選擇尚未結束的時間。' };
  }

  const ref = docRef()!;
  try {
    const settings = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = parseDoc(snap.data());
      if (current.triggerLockUntilMs && current.triggerLockUntilMs > Date.now()) {
        throw new Error('正在關閉器材，請稍後再設定。');
      }
      const next: ShutdownDoc = {
        ...current,
        passcode: params.passcode,
        startTime: params.startTime,
        endTime: params.endTime,
        startDate,
        endDate: bounds.endDate,
        effectiveFromMs: bounds.from.getTime(),
        effectiveUntilMs: bounds.until.getTime(),
        isActive: true,
        ticketHash: null,
        ticketExpiresAtMs: null,
        failedAttempts: 0,
        lockedUntilMs: null,
        triggerLockUntilMs: null,
      };
      tx.set(ref, {
        passcode: params.passcode,
        startTime: params.startTime,
        endTime: params.endTime,
        startDate,
        endDate: bounds.endDate,
        effectiveFrom: admin.firestore.Timestamp.fromDate(bounds.from),
        effectiveUntil: admin.firestore.Timestamp.fromDate(bounds.until),
        isActive: true,
        ticketHash: null,
        ticketExpiresAt: null,
        failedAttempts: 0,
        lockedUntil: null,
        triggerLockUntil: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return toView(next, []);
    });
    const logs = await readLogs();
    return { success: true, settings: { ...settings, logs } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '無法儲存設定。';
    return { success: false, error: message };
  }
}

export async function rotateFacilityShutdownPasscode(adminUserId: string): Promise<
  { success: true; passcode: string } | { success: false; error: string }
> {
  const authError = await assertAdmin(adminUserId);
  if (authError) return { success: false, error: authError };
  if (!db) return { success: false, error: '後端資料庫未連接。' };
  const ref = docRef()!;
  const passcode = randomFacilityPasscode();
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = parseDoc(snap.data());
      if (!current.isActive || !current.passcode) {
        throw new Error('尚未儲存設定。');
      }
      if (current.triggerLockUntilMs && current.triggerLockUntilMs > Date.now()) {
        throw new Error('正在關閉器材，請稍後再設定。');
      }
      tx.update(ref, {
        passcode,
        ticketHash: null,
        ticketExpiresAt: null,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    return { success: true, passcode };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '無法更新密碼。';
    return { success: false, error: message };
  }
}

export async function cancelFacilityShutdownSettings(adminUserId: string): Promise<
  { success: true } | { success: false; error: string }
> {
  const authError = await assertAdmin(adminUserId);
  if (authError) return { success: false, error: authError };
  if (!db) return { success: false, error: '後端資料庫未連接。' };
  const ref = docRef()!;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = parseDoc(snap.data());
      if (current.triggerLockUntilMs && current.triggerLockUntilMs > Date.now()) {
        throw new Error('正在關閉器材，請稍後再取消。');
      }
      tx.set(ref, {
        passcode: null,
        startTime: null,
        endTime: null,
        startDate: null,
        endDate: null,
        effectiveFrom: null,
        effectiveUntil: null,
        isActive: false,
        ticketHash: null,
        ticketExpiresAt: null,
        failedAttempts: 0,
        lockedUntil: null,
        triggerLockUntil: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '無法取消時段。';
    return { success: false, error: message };
  }
}

/** 公開頁只知道現在能不能輸入密碼，不回傳時段或密碼。 */
export async function isFacilityShutdownWindowOpen(): Promise<boolean> {
  const ref = docRef();
  if (!ref) return false;
  const snap = await ref.get();
  const current = await clearExpiredWindow(parseDoc(snap.data()));
  return isOpenNow(current);
}

export async function verifyFacilityShutdownPasscode(passcode: string): Promise<
  { status: 'ok'; ticket: string } | { status: 'closed' | 'invalid' }
> {
  if (!/^\d{4}$/.test(passcode)) return { status: 'invalid' };
  if (!db) return { status: 'invalid' };
  const ref = docRef()!;
  const existing = await ref.get();
  await clearExpiredWindow(parseDoc(existing.data()));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = parseDoc(snap.data());
    const now = Date.now();
    const locked = !!current.lockedUntilMs && current.lockedUntilMs > now;
    const open = isOpenNow(current);
    if (!open) return { status: 'closed' as const };
    if (locked || !hashesEqual(passcode, current.passcode!)) {
      if (!locked) {
        const attempts = current.failedAttempts + 1;
        const update: Record<string, unknown> = { failedAttempts: attempts };
        if (attempts >= MAX_FAILURES) {
          update.failedAttempts = 0;
          update.lockedUntil = admin.firestore.Timestamp.fromMillis(now + LOCK_MS);
        }
        tx.update(ref, update);
      }
      return { status: 'invalid' as const };
    }

    const ticket = randomBytes(32).toString('hex');
    tx.update(ref, {
      failedAttempts: 0,
      lockedUntil: null,
      ticketHash: sha256(ticket),
      ticketExpiresAt: admin.firestore.Timestamp.fromMillis(now + TICKET_TTL_MS),
    });
    return { status: 'ok' as const, ticket };
  });
}

export async function triggerFacilityShutdown(ticket: string): Promise<FacilityShutdownPublicStatus> {
  if (!/^[a-f0-9]{64}$/.test(ticket) || !db) return 'invalid';
  const ref = docRef()!;

  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = parseDoc(snap.data());
    const now = Date.now();
    if (current.triggerLockUntilMs && current.triggerLockUntilMs > now) return 'busy' as const;
    if (!current.isActive || !current.passcode || !current.ticketHash || !current.ticketExpiresAtMs) return 'invalid' as const;
    if (current.ticketExpiresAtMs <= now) return 'invalid' as const;
    if (!sameSecret(sha256(ticket), current.ticketHash)) return 'invalid' as const;
    if (!isOpenNow(current)) return 'closed' as const;
    tx.update(ref, {
      isActive: false,
      ticketHash: null,
      ticketExpiresAt: null,
      triggerLockUntil: admin.firestore.Timestamp.fromMillis(now + TRIGGER_LOCK_MS),
    });
    return {
      status: 'claimed' as const,
      passcode: current.passcode!,
      startTime: current.startTime!,
      endTime: current.endTime!,
      startDate: current.startDate!,
      endDate: current.endDate!,
    };
  });

  if (typeof claim === 'string') return claim;

  const calendarResult = await createFacilityCloseAllEvent(new Date());
  if (!calendarResult.ok) {
    console.error('[facility-shutdown] calendar event failed', calendarResult.error);
    await ref.update({
      isActive: true,
      triggerLockUntil: null,
    });
    return 'failed';
  }

  const batch = db.batch();
  const logRef = db.collection(LOG_COLLECTION).doc();
  batch.set(logRef, {
    triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    startDate: claim.startDate,
    endDate: claim.endDate,
    startTime: claim.startTime,
    endTime: claim.endTime,
    passcode: claim.passcode,
  });
  batch.update(ref, {
    isActive: false,
    passcode: null,
    startTime: null,
    endTime: null,
    startDate: null,
    endDate: null,
    effectiveFrom: null,
    effectiveUntil: null,
    triggerLockUntil: null,
    failedAttempts: 0,
    lockedUntil: null,
    ticketHash: null,
    ticketExpiresAt: null,
  });
  await batch.commit();
  return 'ok';
}
