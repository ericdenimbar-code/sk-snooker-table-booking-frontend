import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import admin from 'firebase-admin';
import { db } from '@/lib/firebase-admin';
import { formatInTimeZone } from 'date-fns-tz';
import { createFacilityCloseAllEvent } from '@/lib/google-calendar';
import { isWithinShutdownWindow, parseHm } from '@/lib/facility-shutdown-window';

const HKT = 'Asia/Hong_Kong';
const COLLECTION = 'facilityShutdown';
const DOC_ID = 'current';
const TICKET_TTL_MS = 3 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const TRIGGER_LOCK_MS = 60 * 1000;

export type FacilityShutdownPublicStatus = 'ok' | 'closed' | 'invalid' | 'busy' | 'failed';

export type FacilityShutdownSettingsView = {
  passcode: string | null;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
  triggeredAtIso: string | null;
  triggeredAtLabel: string | null;
};

type ShutdownDoc = {
  passcode: string | null;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
  triggeredAtMs: number | null;
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
    triggeredAtMs: null,
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
  return {
    passcode,
    startTime,
    endTime,
    isActive: data.isActive === true,
    triggeredAtMs: millisOf(data.triggeredAt),
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

function toView(doc: ShutdownDoc): FacilityShutdownSettingsView {
  const triggeredAtIso = doc.triggeredAtMs ? new Date(doc.triggeredAtMs).toISOString() : null;
  const active = doc.isActive && !!doc.passcode && !!doc.startTime && !!doc.endTime;
  return {
    passcode: active ? doc.passcode : null,
    startTime: active ? doc.startTime : null,
    endTime: active ? doc.endTime : null,
    isActive: active,
    triggeredAtIso,
    triggeredAtLabel: doc.triggeredAtMs
      ? formatInTimeZone(new Date(doc.triggeredAtMs), HKT, 'yyyy-MM-dd HH:mm:ss')
      : null,
  };
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

export async function getFacilityShutdownSettingsForAdmin(adminUserId: string): Promise<
  { success: true; settings: FacilityShutdownSettingsView } | { success: false; error: string }
> {
  const authError = await assertAdmin(adminUserId);
  if (authError) return { success: false, error: authError };
  const ref = docRef();
  if (!ref) return { success: false, error: '後端資料庫未連接。' };
  const snap = await ref.get();
  return { success: true, settings: toView(parseDoc(snap.data())) };
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

  const ref = docRef()!;
  try {
    const settings = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = parseDoc(snap.data());
      if (current.triggerLockUntilMs && current.triggerLockUntilMs > Date.now()) {
        throw new Error('正在關閉器材，請稍後再設定。');
      }
      tx.set(ref, {
        passcode: params.passcode,
        startTime: params.startTime,
        endTime: params.endTime,
        isActive: true,
        triggeredAt: current.triggeredAtMs ? admin.firestore.Timestamp.fromMillis(current.triggeredAtMs) : null,
        ticketHash: null,
        ticketExpiresAt: null,
        failedAttempts: 0,
        lockedUntil: null,
        triggerLockUntil: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return toView({
        ...current,
        passcode: params.passcode,
        startTime: params.startTime,
        endTime: params.endTime,
        isActive: true,
        ticketHash: null,
        ticketExpiresAtMs: null,
        failedAttempts: 0,
        lockedUntilMs: null,
        triggerLockUntilMs: null,
      });
    });
    return { success: true, settings };
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

/** 公開頁只知道現在能不能輸入密碼，不回傳時段或密碼。 */
export async function isFacilityShutdownWindowOpen(): Promise<boolean> {
  const ref = docRef();
  if (!ref) return false;
  const snap = await ref.get();
  const current = parseDoc(snap.data());
  if (!current.isActive || !current.passcode || !current.startTime || !current.endTime) return false;
  return isWithinShutdownWindow(new Date(), current.startTime, current.endTime);
}

export async function verifyFacilityShutdownPasscode(passcode: string): Promise<
  { status: 'ok'; ticket: string } | { status: 'closed' | 'invalid' }
> {
  if (!/^\d{4}$/.test(passcode)) return { status: 'invalid' };
  if (!db) return { status: 'invalid' };
  const ref = docRef()!;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = parseDoc(snap.data());
    const now = Date.now();
    const configured = current.isActive && !!current.passcode && !!current.startTime && !!current.endTime;
    const locked = !!current.lockedUntilMs && current.lockedUntilMs > now;
    const open = configured && isWithinShutdownWindow(new Date(), current.startTime!, current.endTime!);
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
    if (!current.startTime || !current.endTime || !isWithinShutdownWindow(new Date(), current.startTime, current.endTime)) {
      return 'closed' as const;
    }
    tx.update(ref, {
      isActive: false,
      ticketHash: null,
      ticketExpiresAt: null,
      triggerLockUntil: admin.firestore.Timestamp.fromMillis(now + TRIGGER_LOCK_MS),
    });
    return 'claimed' as const;
  });

  if (claim !== 'claimed') return claim;

  const calendarResult = await createFacilityCloseAllEvent(new Date());
  if (!calendarResult.ok) {
    console.error('[facility-shutdown] calendar event failed', calendarResult.error);
    await ref.update({
      isActive: true,
      triggerLockUntil: null,
    });
    return 'failed';
  }

  await ref.update({
    isActive: false,
    passcode: null,
    startTime: null,
    endTime: null,
    triggeredAt: admin.firestore.FieldValue.serverTimestamp(),
    triggerLockUntil: null,
    failedAttempts: 0,
    lockedUntil: null,
    ticketHash: null,
    ticketExpiresAt: null,
  });
  return 'ok';
}
