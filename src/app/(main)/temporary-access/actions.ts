
'use server';

import { randomBytes } from 'crypto';
import qrcode from 'qrcode';
import { addMinutes } from 'date-fns';
import { deleteGoogleCalendarEvent, syncTemporaryAccessSegmentToCalendar } from '@/lib/google-calendar';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/firebase-admin';
import type { TemporaryAccess } from '@/types';
import {
    getHktBookingStartUtc,
    getTempAccessSegmentForBooking,
    getTempAccessSegmentForInstant,
    type TempAccessSegment,
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
    /** 管理員／自選時段申請時必填；VVIP 一鍵申請時可省略 */
    date?: string;
    startTime?: string;
    endTime?: string;
    /** 管理員代訪客接收 QR 的電郵；空則使用登入者電郵 */
    recipientEmail?: string;
    /** 僅管理員：畫面上顯示的香港時間區間文案，寫入 Firestore */
    displayRangeHkt?: string;
};

const TEMP_ACCESS_COLLECTION = 'temporaryAccess';
const TEMP_ACCESS_REQUESTS_COLLECTION = 'temporaryAccessRequests';
const SEGMENT_COLLECTION = 'temporaryAccessSegments';

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
        const docs = snap.docs.map((d) => d.data() as TemporaryAccess);
        const hasMore = docs.length > pageSize;
        const items = hasMore ? docs.slice(0, pageSize) : docs;
        const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

        return { success: true, items, nextCursor };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

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
            .map((doc) => ({ ...(doc.data() as TemporaryAccess), id: doc.id }))
            .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

        if (activeCodes.length === 0) {
            return { success: true, activeCode: null };
        }

        return { success: true, activeCode: activeCodes[0] };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, error: msg };
    }
}

export async function createTemporaryAccessCode(data: CreateCodeData): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    const store = db;

    const { userId, userEmail, date, startTime, recipientEmail, displayRangeHkt } = data;

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
            const activeCodeCheck = await getActiveOrPendingVvipHold(userId);
            if (activeCodeCheck.blocked) {
                return {
                    success: false,
                    error:
                        '您已有一個生效中的臨時進出碼，或上一筆已過期但仍未取消。請先按下「取消此時段」後方可再次申請。',
                };
            }
        }

        let segment: TempAccessSegment;
        let validFrom: Date;
        let validUntil: Date;

        if (isVvip) {
            segment = getTempAccessSegmentForInstant(requestedAt);
            validFrom = requestedAt;
            validUntil = addMinutes(requestedAt, 30);
        } else if (isAdmin) {
            if (!date || !startTime) {
                return { success: false, error: '請選擇日期與時段。' };
            }
            segment = getTempAccessSegmentForBooking(date, startTime);
            validFrom = segment.validFrom;
            validUntil = segment.validUntil;
        } else {
            if (!date || !startTime) {
                return { success: false, error: '請選擇日期與時段。' };
            }
            segment = getTempAccessSegmentForBooking(date, startTime);
            const bookingStart = getHktBookingStartUtc(date, startTime);
            validFrom = bookingStart;
            validUntil = addMinutes(bookingStart, 30);
        }

        const applicationId = store.collection(TEMP_ACCESS_COLLECTION).doc().id;
        const applicationRef = store.collection(TEMP_ACCESS_COLLECTION).doc(applicationId);
        const applicationRequestsRef = store.collection(TEMP_ACCESS_REQUESTS_COLLECTION).doc(applicationId);

        let sharedSecret = '';
        let segmentCreated = false;

        await store.runTransaction(async (tx) => {
            const segRef = store.collection(SEGMENT_COLLECTION).doc(segment.segmentKey);
            const segSnap = await tx.get(segRef);
            if (segSnap.exists) {
                const d = segSnap.data() as { secret?: string };
                sharedSecret = d.secret ?? '';
            } else {
                sharedSecret = `qs${randomBytes(12).toString('hex')}`;
                segmentCreated = true;
                tx.set(segRef, {
                    segmentKey: segment.segmentKey,
                    secret: sharedSecret,
                    validFrom: segment.validFrom.toISOString(),
                    validUntil: segment.validUntil.toISOString(),
                    updatedAt: requestedAt.toISOString(),
                });
            }

            if (!sharedSecret) {
                throw new Error('無法取得時段共用密鑰。');
            }

            const createdAtIso = requestedAt.toISOString();
            const firestoreDoc: Record<string, string> = {
                id: applicationId,
                userId,
                userEmail: sessionEmail || resolvedRecipient,
                recipientEmail: resolvedRecipient,
                validFrom: validFrom.toISOString(),
                validUntil: validUntil.toISOString(),
                status: 'active',
                segmentKey: segment.segmentKey,
                sharedSecret,
                createdAt: createdAtIso,
                requestedAt: createdAtIso,
            };
            if (isAdmin && displayRangeHkt?.trim()) {
                firestoreDoc.displayRangeHkt = displayRangeHkt.trim();
            }

            tx.set(applicationRef, firestoreDoc);
            tx.set(applicationRequestsRef, firestoreDoc);
        });

        if (segmentCreated || isAdmin) {
            const ok = await syncTemporaryAccessSegmentToCalendar({
                segmentKey: segment.segmentKey,
                secret: sharedSecret,
                startIso: segment.validFrom.toISOString(),
                endIso: segment.validUntil.toISOString(),
            });
            if (!ok) {
                console.warn(`Segment ${segment.segmentKey}: calendar sync skipped or failed.`);
            }
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
            segmentKey: segment.segmentKey,
            sharedSecret,
            createdAt: createdAtIso,
            requestedAt: createdAtIso,
            ...(isAdmin && displayRangeHkt?.trim() ? { displayRangeHkt: displayRangeHkt.trim() } : {}),
        };

        if (!isAdmin) {
            const settings = await getRoomSettings('1');
            const contactInfo = settings?.contactInfo ?? {
                name: '',
                email: '',
                whatsapp: '',
                address: '',
                additionalInfo: '',
            };

            const qrPayload = sharedSecret;
            const qrCodeDataUrl = await qrcode.toDataURL(qrPayload, {
                errorCorrectionLevel: 'H',
                margin: 2,
                scale: 8,
            });

            await sendTemporaryAccessQrEmail({
                recipientEmail: resolvedRecipient,
                qrSecret: qrPayload,
                qrCodeDataUrl,
                requestedAtIso: createdAtIso,
                audience: isVvip ? 'vvip' : 'other',
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

/** VVIP：任一 active 紀錄（含已過期但未取消者）皆阻擋再次申請 */
async function getActiveOrPendingVvipHold(userId: string): Promise<{ blocked: boolean }> {
    if (!db) return { blocked: false };
    const snapshot = await db.collection(TEMP_ACCESS_COLLECTION).where('userId', '==', userId).where('status', '==', 'active').get();
    if (snapshot.empty) return { blocked: false };
    return { blocked: true };
}

export async function cancelTemporaryAccessCode(codeId: string, userId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    try {
        const docRef = db.collection(TEMP_ACCESS_COLLECTION).doc(codeId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            return { success: false, error: '找不到指定的臨時碼。' };
        }

        const codeData = { ...(docSnap.data() as TemporaryAccess), id: docSnap.id };
        const userDoc = await db.collection('users').doc(userId).get();
        const userRole = userDoc.data()?.role;

        if (codeData.userId !== userId && (userRole as string | undefined)?.toLowerCase() !== 'admin') {
            return { success: false, error: '權限不足，無法取消此臨時碼。' };
        }

        await docRef.update({ status: 'cancelled' });

        const reqRef = db.collection(TEMP_ACCESS_REQUESTS_COLLECTION).doc(codeId);
        const reqSnap = await reqRef.get();
        if (reqSnap.exists) {
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
