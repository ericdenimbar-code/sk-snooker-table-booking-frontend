'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/firebase-admin';
import type { TokenPurchaseRequest, UserNotification, Reservation } from '@/types';
import { adjustUserTokens, getUserByEmail, type User as AppUser } from '../users/actions';
import admin from 'firebase-admin';

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
    if (!db) return { success: false, error: '後端資料庫未連接。' };
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
    if (!db) return { success: false, error: '後端資料庫未連接。' };
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
     if (!db) return { success: false, error: '後端資料庫未連接。' };
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


// --- User submits proof of payment ---
export async function submitPaymentProof(requestId: string, paymentProofUrl: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        const docRef = db.collection(TOKEN_REQUESTS_COLLECTION).doc(requestId);
        
        await docRef.update({
            paymentProofUrl: paymentProofUrl,
            status: 'processing'
        });
        
        const updatedDoc = await docRef.get();
        if (!updatedDoc.exists) {
            throw new Error("找不到該請求，可能已被刪除。");
        }
        const updatedRequest = updatedDoc.data() as TokenPurchaseRequest;

        revalidatePath('/admin/token-requests');
        revalidatePath('/purchase-tokens');
        
        return { success: true, updatedRequest };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}


// --- Admin approves a request ---
export async function approveTokenPurchaseRequest(
    requestId: string, 
    userEmail: string, 
    tokenQuantity: number,
    linkedReservationId?: string,
): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };

    const user = await getUserByEmail(userEmail);
    if (!user || !user.id) {
        return { success: false, error: `在資料庫中找不到電郵為 ${userEmail} 的使用者。` };
    }
    const userId = user.id;
    
    // First, approve the linked reservation if it exists
    if (linkedReservationId) {
        try {
            const reservationRef = db.collection(RESERVATIONS_COLLECTION).doc(linkedReservationId);
            await reservationRef.update({ status: 'Confirmed' });
            revalidatePath('/admin/bookings');
            revalidatePath('/reservations');
        } catch (e: any) {
            return { success: false, error: `更新預訂狀態時失敗: ${e.message}` };
        }
    }

    // Then, top up the user's account
    const tokenResult = await adjustUserTokens(userId, tokenQuantity);
    if (!tokenResult.success) {
        // Important: If token top-up fails, we should ideally roll back the reservation status change.
        // For simplicity now, we just report the error.
        return { success: false, error: `預訂狀態已更新，但增加餘額失敗: ${tokenResult.error}` };
    }

    // Finally, update the token request status
    try {
        await db.collection(TOKEN_REQUESTS_COLLECTION).doc(requestId).update({
            status: 'completed',
            completionDate: new Date().toISOString()
        });
    } catch (e: any) {
        return { success: false, error: `餘額已增加，但更新請求狀態時失敗: ${e.message}` };
    }

    // Create a notification for the user
    try {
        const notification: UserNotification = {
            id: `N-${Date.now()}`,
            title: linkedReservationId ? '預訂及增值成功！' : '增值成功！',
            description: linkedReservationId 
                ? `您的預訂 (Ref: ${linkedReservationId}) 已確認，並成功增值 HKD ${tokenQuantity}。`
                : `您購買的 HKD ${tokenQuantity} 已成功存入您的帳戶。感謝您的惠顧！`,
            timestamp: new Date().toISOString(),
            isRead: false
        };
        await db.collection(USERS_COLLECTION).doc(userId).collection('notifications').doc(notification.id).set(notification);

    } catch(e: any) {
        console.error(`Failed to create notification for ${userEmail}: ${e.message}`);
    }

    revalidatePath('/admin/token-requests');
    revalidatePath('/admin/users');
    revalidatePath('/purchase-tokens');
    return { success: true };
}

// --- Admin or user cancels a request ---
export async function cancelTokenPurchaseRequest(requestId: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
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
    if (!db) return null;

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
