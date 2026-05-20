
'use server';

import { randomBytes } from 'crypto';
import qrcode from 'qrcode';
import { addMinutes } from 'date-fns';
import {
    deleteGoogleCalendarEvent,
    syncTemporaryAccessApplicationToCalendar,
} from '@/lib/google-calendar';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/firebase-admin';
import type { TemporaryAccess } from '@/types';
import {
    getAdminSlotPeriodHkt,
    getDailyKeyPeriodForInstant,
    getHktBookingStartUtc,
    VVIP_BUFFER_MINUTES,
    VVIP_CALENDAR_TOTAL_MINUTES,
} from '@/lib/hkt-temp-segment';
import { sendTemporaryAccessQrEmail } from '@/lib/email';
import { getRoomSettings } from '@/app/admin/settings/actions';

type ServerActionResponse = {
    success: boolean;
    error?: string;
    qrCodeUrl?: string;
    newCode?: TemporaryAccess;
    activeCode?: TemporaryAccess | null;
};

type CreateCodeData = {
    userId: string;
    userEmail: string;
    date?: string;
    startTime?: string;
    endTime?: string;
    recipientEmail?: string;
    displayRangeHkt?: string;
};

const TEMP_ACCESS_COLLECTION = 'temporaryAccess';
const TEMP_ACCESS_REQUESTS_COLLECTION = 'temporaryAccessRequests';
const SEGMENT_COLLECTION = 'temporaryAccessSegments';

function docToTemporaryAccess(id: string, data: FirebaseFirestore.DocumentData): TemporaryAccess {
    return { ...(data as TemporaryAccess), id };
}

export async function listTemporaryAccessApplications(params: {
    adminUserId: string;
    pageSize?: number;
    cursorId?: string | null;
}): Promise<{
    success: boolean;
    error?: string;
    items?: TemporaryAccess[];
    nextCursor?: string | null;
}> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    const pageSize = Math.min(Math.max(params.pageSize ?? 10, 1), 50);

    try {
        const adminDoc = await db.collection('users').doc(params.adminUserId).get();
        const role = adminDoc.data()?.role?.toLowerCase();
        if (!adminDoc.exists || role !== 'admin') {
            return { success: false, error: '權限不足。' };
        }

        let q = db
            .collection(TEMP_ACCESS_COLLECTION)
            .orderBy('createdAt', 'desc')
            .limit(pageSize + 1);

        if (params.cursorId) {
            const cur = await db.collection(TEMP_ACCESS_COLLECTION).doc(params.cursorId).get();
            if (cur.exists) {
                q = q.startAfter(cur);
            }
        }

        const snap = await q.get();
        const docs = snap.docs.map((d) => docToTemporaryAccess(d.id, d.data()));
        const hasMore = docs.length > pageSize;
        const items = hasMore ? docs.slice(0, pageSize) : docs;
        const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

        return { success: true, items, nextCursor };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

async function expireCodeIfPast(code: TemporaryAccess): Promise<boolean> {
    if (!db || code.status !== 'active') return false;
    const endMs = new Date(code.validUntil).getTime();
    if (endMs > Date.now()) return false;

    const ref = db.collection(TEMP_ACCESS_COLLECTION).doc(code.id);
    await ref.update({ status: 'expired' });
    const reqRef = db.collection(TEMP_ACCESS_REQUESTS_COLLECTION).doc(code.id);
    const reqSnap = await reqRef.get();
    if (reqSnap.exists) {
        await reqRef.update({ status: 'expired' });
    }
    return true;
}

/** VVIP：讀取有效申請；已過期則自動標記 expired */
export async function getActiveTemporaryAccessCode(userId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const role = userDoc.data()?.role?.toLowerCase() ?? '';
        if (role === 'admin') {
            return { success: true, activeCode: null };
        }

        const snapshot = await db
            .collection(TEMP_ACCESS_COLLECTION)
            .where('userId', '==', userId)
            .where('status', '==', 'active')
            .get();

        if (snapshot.empty) {
            return { success: true, activeCode: null };
        }

        const activeCodes = snapshot.docs
            .map((doc) => docToTemporaryAccess(doc.id, doc.data()))
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

        if (activeCodes.length === 0) {
            return { success: true, activeCode: null };
        }

        const latest = activeCodes[0];
        const didExpire = await expireCodeIfPast(latest);
        if (didExpire) {
            return { success: true, activeCode: null };
        }

        return { success: true, activeCode: latest };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

/** Admin：持久化預覽（未 dismiss、時段未過） */
export async function getAdminTemporaryAccessPreview(userId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const role = userDoc.data()?.role?.toLowerCase() ?? '';
        if (!userDoc.exists || role !== 'admin') {
            return { success: false, error: '權限不足。' };
        }

        const snapshot = await db
            .collection(TEMP_ACCESS_COLLECTION)
            .where('userId', '==', userId)
            .where('status', '==', 'active')
            .get();

        const now = Date.now();
        const candidates = snapshot.docs
            .map((doc) => docToTemporaryAccess(doc.id, doc.data()))
            .filter((c) => c.adminUiDismissed !== true && new Date(c.validUntil).getTime() > now)
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

        if (candidates.length === 0) {
            return { success: true, activeCode: null };
        }

        return { success: true, activeCode: candidates[0] };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

export async function createTemporaryAccessCode(data: CreateCodeData): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    const store = db;

    const { userId, userEmail, date, startTime, endTime, recipientEmail, displayRangeHkt } = data;

    try {
        const userDoc = await store.collection('users').doc(userId).get();
        const userRole = (userDoc.data()?.role as string | undefined)?.toLowerCase() ?? '';
        const isAdmin = userRole === 'admin';
        const isVvip = userRole === 'vvip';

        const requestedAt = new Date();
        const sessionEmail = (userEmail || '').trim();
        const profileEmail = typeof userDoc.data()?.email === 'string' ? userDoc.data()!.email!.trim() : '';
        const visitorEmail = (recipientEmail || '').trim();
        const resolvedRecipient = visitorEmail || profileEmail || sessionEmail;
        if (!resolvedRecipient) {
            return { success: false, error: '無法取得發送電郵地址，請確認帳戶已設定電郵。' };
        }

        if (isVvip) {
            const activeCodeCheck = await getActiveTemporaryAccessCode(userId);
            if (activeCodeCheck.success && activeCodeCheck.activeCode) {
                return {
                    success: false,
                    error: '您已有生效中的臨時進出碼，請等待本次時段結束後再申請。',
                };
            }
        }

        const dailyPeriod = isVvip
            ? getDailyKeyPeriodForInstant(requestedAt)
            : isAdmin && date && startTime
              ? getDailyKeyPeriodForInstant(getHktBookingStartUtc(date, startTime))
              : date && startTime
                ? getDailyKeyPeriodForInstant(getHktBookingStartUtc(date, startTime))
                : getDailyKeyPeriodForInstant(requestedAt);

        const dayKey = dailyPeriod.dayKey;

        let validFrom: Date;
        let validUntil: Date;
        let effectiveFrom: Date | undefined;
        let calendarUntil: Date | undefined;

        if (isVvip) {
            effectiveFrom = addMinutes(requestedAt, VVIP_BUFFER_MINUTES);
            validFrom = requestedAt;
            validUntil = addMinutes(requestedAt, VVIP_CALENDAR_TOTAL_MINUTES);
            calendarUntil = validUntil;
        } else if (isAdmin) {
            if (!date || !startTime || !endTime) {
                return { success: false, error: '請選擇日期與時段。' };
            }
            const slot = getAdminSlotPeriodHkt(date, startTime, endTime);
            validFrom = slot.validFrom;
            validUntil = slot.validUntil;
        } else {
            if (!date || !startTime) {
                return { success: false, error: '請選擇日期與時段。' };
            }
            const bookingStart = getHktBookingStartUtc(date, startTime);
            validFrom = bookingStart;
            validUntil = addMinutes(bookingStart, 30);
        }

        const applicationId = store.collection(TEMP_ACCESS_COLLECTION).doc().id;
        const applicationRef = store.collection(TEMP_ACCESS_COLLECTION).doc(applicationId);
        const applicationRequestsRef = store.collection(TEMP_ACCESS_REQUESTS_COLLECTION).doc(applicationId);

        let sharedSecret = '';

        await store.runTransaction(async (tx) => {
            const segRef = store.collection(SEGMENT_COLLECTION).doc(dayKey);
            const segSnap = await tx.get(segRef);
            if (segSnap.exists) {
                const d = segSnap.data() as { secret?: string };
                sharedSecret = d.secret ?? '';
            } else {
                sharedSecret = `qs${randomBytes(12).toString('hex')}`;
                tx.set(segRef, {
                    segmentKey: dayKey,
                    secret: sharedSecret,
                    validFrom: dailyPeriod.validFrom.toISOString(),
                    validUntil: dailyPeriod.validUntil.toISOString(),
                    updatedAt: requestedAt.toISOString(),
                });
            }

            if (!sharedSecret) {
                throw new Error('無法取得每日共用密鑰。');
            }

            const createdAtIso = requestedAt.toISOString();
            const firestoreDoc: Record<string, string | boolean> = {
                id: applicationId,
                userId,
                userEmail: sessionEmail || resolvedRecipient,
                recipientEmail: resolvedRecipient,
                validFrom: validFrom.toISOString(),
                validUntil: validUntil.toISOString(),
                status: 'active',
                segmentKey: dayKey,
                sharedSecret,
                createdAt: createdAtIso,
                requestedAt: createdAtIso,
                adminUiDismissed: false,
            };
            if (isAdmin && displayRangeHkt?.trim()) {
                firestoreDoc.displayRangeHkt = displayRangeHkt.trim();
            }
            if (isVvip && effectiveFrom) {
                firestoreDoc.effectiveFrom = effectiveFrom.toISOString();
            }
            if (isVvip && calendarUntil) {
                firestoreDoc.calendarUntil = calendarUntil.toISOString();
            }

            tx.set(applicationRef, firestoreDoc);
            tx.set(applicationRequestsRef, firestoreDoc);
        });

        // 每日密鑰僅存 Firestore；Google Calendar 只寫入單筆申請的精確時段（Admin / VVIP）

        if (isVvip && calendarUntil) {
            // 日曆：申請當下起算，結束 = 申請 + 30 分鐘使用 + 3 分鐘緩衝（門禁同步）
            await syncTemporaryAccessApplicationToCalendar({
                applicationId,
                secret: sharedSecret,
                startIso: requestedAt.toISOString(),
                endIso: calendarUntil.toISOString(),
                description: `VVIP 臨時進出 ${applicationId}`,
            });
        } else if (isAdmin) {
            await syncTemporaryAccessApplicationToCalendar({
                applicationId,
                secret: sharedSecret,
                startIso: validFrom.toISOString(),
                endIso: validUntil.toISOString(),
                description: `Admin 臨時進出 ${applicationId}`,
            });
        }

        const createdAtIso = requestedAt.toISOString();
        const newCode: TemporaryAccess = {
            id: applicationId,
            userId,
            userEmail: sessionEmail || resolvedRecipient,
            recipientEmail: resolvedRecipient,
            validFrom: validFrom.toISOString(),
            validUntil: validUntil.toISOString(),
            status: 'active',
            segmentKey: dayKey,
            sharedSecret,
            createdAt: createdAtIso,
            requestedAt: createdAtIso,
            adminUiDismissed: false,
            ...(isAdmin && displayRangeHkt?.trim() ? { displayRangeHkt: displayRangeHkt.trim() } : {}),
            ...(isVvip && effectiveFrom ? { effectiveFrom: effectiveFrom.toISOString() } : {}),
            ...(isVvip && calendarUntil ? { calendarUntil: calendarUntil.toISOString() } : {}),
        };

        if (!isAdmin && !isVvip) {
            const settings = await getRoomSettings('1');
            const contactInfo = settings?.contactInfo ?? {
                name: '',
                email: '',
                whatsapp: '',
                address: '',
                additionalInfo: '',
            };
            const qrCodeDataUrl = await qrcode.toDataURL(sharedSecret, {
                errorCorrectionLevel: 'H',
                margin: 2,
                scale: 8,
            });
            await sendTemporaryAccessQrEmail({
                recipientEmail: resolvedRecipient,
                qrSecret: sharedSecret,
                qrCodeDataUrl,
                requestedAtIso: createdAtIso,
                audience: 'other',
                contactInfo,
            });
        }

        revalidatePath('/admin/bookings', 'page');
        revalidatePath('/admin', 'page');
        revalidatePath('/temporary-access', 'page');

        return { success: true, newCode };
    } catch (e: unknown) {
        console.error('Error creating temporary access code:', e);
        const msg = e instanceof Error ? e.message : '發生未知錯誤。';
        return { success: false, error: msg };
    }
}

export async function sendAdminTemporaryAccessQrEmail(params: {
    userId: string;
    userEmail: string;
    recipientEmail?: string;
    qrSecret: string;
    requestedAtIso: string;
}): Promise<{ success: boolean; error?: string }> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const userDoc = await db.collection('users').doc(params.userId).get();
        const role = (userDoc.data()?.role as string | undefined)?.toLowerCase();
        if (!userDoc.exists || role !== 'admin') {
            return { success: false, error: '權限不足。' };
        }

        const profileEmail = typeof userDoc.data()?.email === 'string' ? userDoc.data()!.email!.trim() : '';
        const session = (params.userEmail || '').trim();
        const to = (params.recipientEmail || '').trim() || profileEmail || session;
        if (!to) {
            return { success: false, error: '無法取得收件電郵。' };
        }

        const settings = await getRoomSettings('1');
        const contactInfo = settings?.contactInfo ?? {
            name: '',
            email: '',
            whatsapp: '',
            address: '',
            additionalInfo: '',
        };

        const qrCodeDataUrl = await qrcode.toDataURL(params.qrSecret, {
            errorCorrectionLevel: 'H',
            margin: 2,
            scale: 8,
        });

        await sendTemporaryAccessQrEmail({
            recipientEmail: to,
            qrSecret: params.qrSecret,
            qrCodeDataUrl,
            requestedAtIso: params.requestedAtIso,
            audience: 'admin',
            contactInfo,
        });

        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

export async function sendVvipTemporaryAccessQrEmail(params: {
    userId: string;
    userEmail: string;
    qrSecret: string;
    requestedAtIso: string;
}): Promise<{ success: boolean; error?: string }> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const userDoc = await db.collection('users').doc(params.userId).get();
        const role = (userDoc.data()?.role as string | undefined)?.toLowerCase();
        if (!userDoc.exists || role !== 'vvip') {
            return { success: false, error: '權限不足。' };
        }

        const profileEmail = typeof userDoc.data()?.email === 'string' ? userDoc.data()!.email!.trim() : '';
        const session = (params.userEmail || '').trim();
        const to = profileEmail || session;
        if (!to) {
            return { success: false, error: '無法取得收件電郵。' };
        }

        const settings = await getRoomSettings('1');
        const contactInfo = settings?.contactInfo ?? {
            name: '',
            email: '',
            whatsapp: '',
            address: '',
            additionalInfo: '',
        };

        const qrCodeDataUrl = await qrcode.toDataURL(params.qrSecret, {
            errorCorrectionLevel: 'H',
            margin: 2,
            scale: 8,
        });

        await sendTemporaryAccessQrEmail({
            recipientEmail: to,
            qrSecret: params.qrSecret,
            qrCodeDataUrl,
            requestedAtIso: params.requestedAtIso,
            audience: 'vvip',
            contactInfo,
        });

        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

/** VVIP 自動過期：標記 expired，不刪日曆 */
export async function expireTemporaryAccessCode(codeId: string, userId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const docRef = db.collection(TEMP_ACCESS_COLLECTION).doc(codeId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return { success: false, error: '找不到指定的臨時碼。' };
        }

        const codeData = docToTemporaryAccess(docSnap.id, docSnap.data()!);
        if (codeData.userId !== userId) {
            return { success: false, error: '權限不足。' };
        }

        await docRef.update({ status: 'expired' });
        const reqRef = db.collection(TEMP_ACCESS_REQUESTS_COLLECTION).doc(codeId);
        if ((await reqRef.get()).exists) {
            await reqRef.update({ status: 'expired' });
        }

        revalidatePath('/temporary-access', 'page');
        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

/** Admin：僅隱藏前端，不刪除 Google Calendar */
export async function dismissAdminTemporaryAccessPreview(
    codeId: string,
    userId: string,
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const userDoc = await db.collection('users').doc(userId).get();
        const role = userDoc.data()?.role?.toLowerCase();
        if (!userDoc.exists || role !== 'admin') {
            return { success: false, error: '權限不足。' };
        }

        const docRef = db.collection(TEMP_ACCESS_COLLECTION).doc(codeId);
        const docSnap = await docRef.get();
        if (!docSnap.exists) {
            return { success: false, error: '找不到指定的臨時碼。' };
        }

        const codeData = docToTemporaryAccess(docSnap.id, docSnap.data()!);
        if (codeData.userId !== userId) {
            return { success: false, error: '權限不足。' };
        }

        await docRef.update({ adminUiDismissed: true });
        const reqRef = db.collection(TEMP_ACCESS_REQUESTS_COLLECTION).doc(codeId);
        if ((await reqRef.get()).exists) {
            await reqRef.update({ adminUiDismissed: true });
        }

        revalidatePath('/temporary-access', 'page');
        return { success: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

/** 非 Admin 使用者取消（VVIP 手動取消） */
export async function cancelTemporaryAccessCode(codeId: string, userId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const docRef = db.collection(TEMP_ACCESS_COLLECTION).doc(codeId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { success: false, error: '找不到指定的臨時碼。' };
        }

        const codeData = docToTemporaryAccess(docSnap.id, docSnap.data()!);
        const userDoc = await db.collection('users').doc(userId).get();
        const userRole = userDoc.data()?.role?.toLowerCase();

        if (userRole === 'admin') {
            return dismissAdminTemporaryAccessPreview(codeId, userId);
        }

        if (codeData.userId !== userId) {
            return { success: false, error: '權限不足，無法取消此臨時碼。' };
        }

        await docRef.update({ status: 'cancelled' });

        const reqRef = db.collection(TEMP_ACCESS_REQUESTS_COLLECTION).doc(codeId);
        if ((await reqRef.get()).exists) {
            await reqRef.update({ status: 'cancelled' });
        }

        if (!codeData.segmentKey) {
            await deleteGoogleCalendarEvent(codeData);
        }

        revalidatePath('/admin/bookings', 'page');
        revalidatePath('/admin', 'page');
        revalidatePath('/temporary-access', 'page');

        return { success: true };
    } catch (e: unknown) {
        console.error(`Error cancelling temp code ${codeId}:`, e);
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}
