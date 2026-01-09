
'use server';

import { revalidatePath } from 'next/cache';
import { getFirebaseAdmin } from '@/lib/firebase-admin';
import type { TokenPurchaseRequest, UserNotification, Reservation } from '@/types';
import { adjustUserTokens, getUserByEmail, type User as AppUser } from '../users/actions';
import admin from 'firebase-admin';
import { google } from 'googleapis';
import * as logger from "firebase-functions/logger";
import { sendTopUpConfirmationEmail } from '@/lib/email';
import { getRoomSettings } from '../settings/actions';


type ServerActionResponse = {
    success: boolean;
    error?: string;
    [key: string]: any;
};

const TOKEN_REQUESTS_COLLECTION = 'tokenRequests';
const USERS_COLLECTION = 'users';
const RESERVATIONS_COLLECTION = 'reservations';

// --- Create a new token purchase request ---
export async function createTokenPurchaseRequest(
    data: Omit<TokenPurchaseRequest, 'id' | 'status' | 'requestDate' | 'paymentProofUrl' | 'completionDate' | 'expiresAt'>
): Promise<ServerActionResponse> {
    const { db, error } = getFirebaseAdmin();
    if (!db || error) return { success: false, error: '後端資料庫未連接。' };
    try {
        const refNumber = `TR-${Date.now()}`;
        const now = new Date();

        const newRequest: TokenPurchaseRequest = {
            ...data,
            id: refNumber,
            status: 'requesting',
            requestDate: now.toISOString(),
            paymentProofUrl: '',
            completionDate: '',
            // expiresAt is no longer set
        };
        await db.collection(TOKEN_REQUESTS_COLLECTION).doc(refNumber).set(newRequest);
        revalidatePath('/admin/token-requests');
        revalidatePath('/purchase-tokens');
        return { success: true, newRequest };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// --- Get all token purchase requests (for admin) ---
export async function getAllTokenPurchaseRequests(): Promise<ServerActionResponse> {
    const { db, error } = getFirebaseAdmin();
    if (!db || error) return { success: false, error: '後端資料庫未連接。' };
    try {
        const snapshot = await db.collection(TOKEN_REQUESTS_COLLECTION).orderBy('requestDate', 'desc').get();
        const requests = snapshot.docs.map(doc => doc.data() as TokenPurchaseRequest);
        return { success: true, requests };
    } catch (e: any) {
        return { success: false, error: `從資料庫讀取請求時發生錯誤: ${e.message}` };
    }
}

// --- Get all requests for a specific user ---
export async function getTokenPurchaseRequestsByUser(userEmail: string): Promise<ServerActionResponse> {
    const { db, error } = getFirebaseAdmin();
     if (!db || error) return { success: false, error: '後端資料庫未連接。' };
    try {
        const snapshot = await db.collection(TOKEN_REQUESTS_COLLECTION)
            .where('userEmail', '==', userEmail)
            .get();
        
        const requests = snapshot.docs.map(doc => doc.data() as TokenPurchaseRequest);

        requests.sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime());

        return { success: true, requests };
    } catch (e: any) {
        return { success: false, error: `從資料庫讀取您的購買紀錄時發生錯誤: ${e.message}` };
    }
}


// --- Admin approves a request ---
export async function approveTokenPurchaseRequest(
    requestId: string, 
    userEmail: string, 
    tokenQuantity: number,
    linkedReservationId?: string,
): Promise<ServerActionResponse> {
    const { db, error } = getFirebaseAdmin();
    if (!db || error) return { success: false, error: '後端資料庫未連接。' };

    const user = await getUserByEmail(userEmail);
    if (!user || !user.id) {
        return { success: false, error: `在資料庫中找不到電郵為 ${userEmail} 的使用者。` };
    }
    const userId = user.id;

    try {
        let finalUserTokens = 0;
        
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection('users').doc(userId);
            const requestRef = db.collection(TOKEN_REQUESTS_COLLECTION).doc(requestId);
            const userDoc = await transaction.get(userRef);

            if (!userDoc.exists) {
                throw new Error(`找不到ID為 ${userId} 的使用者。`);
            }

            const currentTokens = userDoc.data()?.tokens ?? 0;
            finalUserTokens = currentTokens + tokenQuantity;

            // 1. Update user tokens
            transaction.update(userRef, { tokens: admin.firestore.FieldValue.increment(tokenQuantity) });
            
            // 2. Update token request status
            transaction.update(requestRef, {
                status: 'completed',
                completionDate: new Date().toISOString()
            });

            // 3. Update linked reservation if it exists
            if (linkedReservationId) {
                const reservationRef = db.collection(RESERVATIONS_COLLECTION).doc(linkedReservationId);
                transaction.update(reservationRef, { status: 'Confirmed' });
            }
        });

        // --- Post-transaction side effects ---

        // A. Create a notification for the user (to trigger UI refresh)
        const notification: UserNotification = {
            id: `N-${Date.now()}`,
            title: '增值成功！',
            description: `您購買的 HKD ${tokenQuantity} 已成功存入您的帳戶。感謝您的惠顧！`,
            timestamp: new Date().toISOString(),
            isRead: false
        };
        await db.collection(USERS_COLLECTION).doc(userId).collection('notifications').doc(notification.id).set(notification);
        
        // B. Send confirmation email
        const settings = await getRoomSettings('1'); // Get settings for email content
        if (settings) {
            await sendTopUpConfirmationEmail(user, tokenQuantity, finalUserTokens, settings.contactInfo);
        } else {
            console.error(`[CRITICAL] Failed to send top-up email to ${userEmail}: Cannot load settings.`);
        }
        
        revalidatePath('/admin/token-requests');
        revalidatePath('/admin/users');
        revalidatePath('/purchase-tokens');
        if(linkedReservationId) {
            revalidatePath('/admin/bookings');
            revalidatePath('/reservations');
        }

        return { success: true };
    
    } catch (e: any) {
        console.error(`Error during 'approveTokenPurchaseRequest' for request ${requestId}:`, e);
        return { success: false, error: e.message };
    }
}

// --- Admin or user cancels a request ---
export async function cancelTokenPurchaseRequest(requestId: string): Promise<ServerActionResponse> {
    const { db, error } = getFirebaseAdmin();
    if (!db || error) return { success: false, error: '後端資料庫未連接。' };
    try {
        const requestRef = db.collection(TOKEN_REQUESTS_COLLECTION).doc(requestId);
        const requestSnap = await requestRef.get();
        if (!requestSnap.exists) {
            return { success: false, error: '找不到該請求。' };
        }
        const requestData = requestSnap.data() as TokenPurchaseRequest;

        const batch = db.batch();

        // 1. Mark the token request as cancelled
        batch.update(requestRef, { status: 'cancelled' });

        // 2. If it's linked to a reservation, cancel that reservation too and refund tokens if necessary
        if (requestData.linkedReservationId) {
            const reservationRef = db.collection(RESERVATIONS_COLLECTION).doc(requestData.linkedReservationId);
            const reservationSnap = await reservationRef.get();
            if (reservationSnap.exists) {
                const reservationData = reservationSnap.data() as Reservation;
                batch.update(reservationRef, { status: 'Cancelled' });

                // Refund the token part of a mixed payment
                if (reservationData.paymentMethod === 'mixed' && reservationData.amountPaidWithTokens && reservationData.amountPaidWithTokens > 0) {
                     const user = await getUserByEmail(requestData.userEmail);
                     if (user && user.id) {
                         const userRef = db.collection(USERS_COLLECTION).doc(user.id);
                         batch.update(userRef, { tokens: admin.firestore.FieldValue.increment(reservationData.amountPaidWithTokens) });
                     }
                }
            }
        }
        
        await batch.commit();

        revalidatePath('/admin/token-requests');
        revalidatePath('/purchase-tokens');
        revalidatePath('/admin/bookings');
        revalidatePath('/reservations');

        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}


// --- Check and clear notifications for a user ---
export async function checkAndClearUserNotifications(userEmail: string): Promise<{ notifications: UserNotification[], user: AppUser | null } | null> {
    const { db, error } = getFirebaseAdmin();
    if (!db || error) return null;

    const user = await getUserByEmail(userEmail);
     if (!user || !user.id) {
        console.error(`Could not find user with email ${userEmail} to check notifications.`);
        return null;
    }
    const userId = user.id;

    const notificationsRef = db.collection(USERS_COLLECTION).doc(userId).collection('notifications');
    const userRef = db.collection(USERS_COLLECTION).doc(userId);
    
    try {
        const [notificationsSnapshot, userSnapshot] = await db.getAll(notificationsRef, userRef);

        const notifications = notificationsSnapshot.docs.map(doc => doc.data() as UserNotification);
        
        let latestUserData: AppUser | null = null;
        if (userSnapshot.exists) {
            const data = userSnapshot.data();
            latestUserData = {
                id: userSnapshot.id,
                name: data?.name || '',
                email: data?.email || '',
                phone: data?.phone || '',
                tokens: data?.tokens ?? 0,
                role: data?.role || 'User',
                joinedDate: data?.joinedDate || '',
                fpsPayerNames: data?.fpsPayerNames || '', // Ensure field is returned
            };
        }
        
        if (notifications.length > 0) {
            const batch = db.batch();
            notificationsSnapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }

        // Always return the latest user data, even if there are no notifications.
        // This allows role changes etc. to be synced.
        return { notifications, user: latestUserData };
    } catch (e: any) {
        console.error(`Error checking notifications for ${userEmail}:`, e);
        return null;
    }
}

// --- NEW: Manually Triggered Gmail Check ---

function parsePaymentEmail(body: string): { amount: number | null, payer: string | null } {
    const amountMatch = body.match(/金額為\\s*HKD\\s*([\\d,]+\\.?\\d*)/);
    const payerMatch = body.match(/你已收到\\s*(.+?)\\s*的轉賬/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
    const payer = payerMatch ? payerMatch[1].trim() : null;
    return { amount, payer };
}

export async function triggerGmailCheck(): Promise<ServerActionResponse> {
    const GMAIL_USER = process.env.EMAIL_SERVER_USER;
    const SERVICE_ACCOUNT_EMAIL = process.env.SERVICE_ACCOUNT_CLIENT_EMAIL;
    const PRIVATE_KEY = process.env.SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
    
    const { db, error: dbError } = getFirebaseAdmin();
    if (!db || dbError) return { success: false, error: "後端資料庫未連接。" };

    if (!GMAIL_USER || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
        return { success: false, error: "缺少必要的 Gmail API 環境變數設定。" };
    }

    try {
        const auth = new google.auth.JWT({
            email: SERVICE_ACCOUNT_EMAIL,
            key: PRIVATE_KEY,
            scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'],
            subject: GMAIL_USER, // Impersonate the user
        });

        const gmail = google.gmail({ version: 'v1', auth });

        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread from:(do-not-reply@welab.bank) subject:(你已收到)',
        });

        const messages = listRes.data.messages;
        if (!messages || messages.length === 0) {
            return { success: true, message: "沒有新的未讀郵件。", processedCount: 0 };
        }

        let processedCount = 0;
        let errors: string[] = [];

        for (const message of messages) {
            if (!message.id) continue;

            try {
                const msgRes = await gmail.users.messages.get({ userId: 'me', id: message.id, format: 'full' });
                const bodyData = msgRes.data.payload?.parts?.find(p => p.mimeType === 'text/plain')?.body?.data;
                if (!bodyData) {
                    await gmail.users.messages.modify({ userId: 'me', id: message.id, requestBody: { removeLabelIds: ['UNREAD'] } });
                    continue;
                }
                
                const emailBody = Buffer.from(bodyData, 'base64').toString('utf8');
                const { amount, payer } = parsePaymentEmail(emailBody);

                if (amount !== null && payer !== null) {
                    const requestsQuery = db.collection('tokenRequests')
                        .where('status', 'in', ['requesting', 'processing'])
                        .where('totalPriceHKD', '==', amount);
                    
                    const requestSnapshot = await requestsQuery.get();

                    if (requestSnapshot.size === 1) {
                        const requestDoc = requestSnapshot.docs[0];
                        const requestData = requestDoc.data() as TokenPurchaseRequest;
                        
                        await approveTokenPurchaseRequest(requestData.id, requestData.userEmail, requestData.tokenQuantity);
                        processedCount++;
                        
                    } else {
                        logger.warn(`Found ${requestSnapshot.size} ambiguous requests for amount ${amount}. Payer was ${payer}. Manual approval needed.`);
                    }
                }
            } catch (procError: any) {
                errors.push(`處理郵件 ${message.id} 時出錯: ${procError.message}`);
            } finally {
                // Always mark as read to avoid reprocessing
                await gmail.users.messages.modify({ userId: 'me', id: message.id, requestBody: { removeLabelIds: ['UNREAD'] } });
            }
        }
        
        revalidatePath('/admin/token-requests');
        revalidatePath('/admin/users');

        if (errors.length > 0) {
            return { success: false, error: errors.join('; '), processedCount };
        }

        return { success: true, message: `成功處理 ${processedCount} 封郵件。`, processedCount };

    } catch (error: any) {
        console.error('FATAL: An unexpected error occurred during the Gmail check:', error);
        return { success: false, error: `觸發 Gmail 檢查時發生嚴重錯誤: ${error.message}` };
    }
}
