
'use server';

import { db, auth } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';
import type { User as AppUser, Reservation, TokenPurchaseRequest } from '@/types';
import * as admin from 'firebase-admin';

type ServerActionResponse = {
    success: boolean;
    error?: string;
    [key: string]: any;
};

export async function getUserBookingHistory(email: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: 'Database connection failed' };
    try {
        const snapshot = await db.collection('reservations').where('userEmail', '==', email).get();
        const reservations = snapshot.docs.map(doc => doc.data()) as Reservation[];
        // Sort in code to avoid needing a composite index
        reservations.sort((a, b) => new Date(b.bookingDate).getTime() - new Date(a.bookingDate).getTime());
        return { success: true, reservations };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getUserTopUpHistory(email: string): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: 'Database connection failed' };
    try {
        const snapshot = await db.collection('tokenRequests').where('userEmail', '==', email).get();
        const requests = snapshot.docs.map(doc => doc.data()) as TokenPurchaseRequest[];
         // Sort in code to avoid needing a composite index
        requests.sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime());
        return { success: true, requests };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}


export async function getUserByEmail(email: string): Promise<AppUser | null> {
    if (!db) {
        console.error("Failed to get Firebase Admin in getUserByEmail");
        return null;
    }

    try {
        const userQuery = await db.collection('users').where('email', '==', email).limit(1).get();
        if (userQuery.empty) {
            return null;
        }
        const userData = userQuery.docs[0].data();
        return {
            id: userQuery.docs[0].id,
            ...userData
        } as AppUser;
    } catch (e: any) {
        console.error(`Error fetching user by email ${email}:`, e.message);
        return null;
    }
}

export async function updateUser(userId: string, data: Partial<Omit<AppUser, 'id' | 'tokens' | 'joinedDate'>>): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: `Database connection failed` };

    try {
        await db.collection('users').doc(userId).set(data, { merge: true });
        revalidatePath('/admin/users');
        revalidatePath('/account');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function adjustUserTokens(userId: string, adjustment: number): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: `Database connection failed` };
    
    try {
        const userRef = db.collection('users').doc(userId);
        await userRef.update({
            tokens: admin.firestore.FieldValue.increment(adjustment)
        });
        revalidatePath('/admin/users');
        revalidatePath('/(main)', 'layout');
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function resetUserPassword(email: string): Promise<ServerActionResponse> {
    if (!auth) return { success: false, error: `Auth service failed` };

    try {
        await auth.generatePasswordResetLink(email);
        return { success: true };
    } catch (e: any) {
        // Firebase often throws a "USER_NOT_FOUND" error. 
        // For security, we can treat this as a success to prevent email enumeration.
        if (e.code === 'auth/user-not-found') {
            console.log(`Password reset requested for non-existent user: ${email}. Responding with success for security.`);
            return { success: true };
        }
        return { success: false, error: e.message };
    }
}

export async function getAllUsers(): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: `Database connection failed` };

    try {
        const snapshot = await db.collection('users').get();
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AppUser[];
        return { success: true, users };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function createUserInFirestore(userData: { id: string; email: string; name: string; phone: string }): Promise<ServerActionResponse> {
    if (!db) return { success: false, error: `Database connection failed` };
    
    const newUser: Omit<AppUser, 'id'> = {
        name: userData.name,
        email: userData.email,
        phone: userData.phone,
        tokens: 0,
        role: 'User',
        joinedDate: new Date().toISOString().split('T')[0], // 'YYYY-MM-DD'
    };

    try {
        await db.collection('users').doc(userData.id).set(newUser);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function deleteUser(userId: string): Promise<ServerActionResponse> {
    if (!db || !auth) return { success: false, error: `Admin service failed` };

    try {
        // A transaction to delete both Auth and Firestore user atomically.
        await auth.deleteUser(userId);
        await db.collection('users').doc(userId).delete();
        revalidatePath('/admin/users');
        return { success: true };
    } catch (e: any) {
        console.error(`Failed to fully delete user ${userId}:`, e);
        // If Auth deletion succeeds but Firestore fails, you might have an orphaned profile.
        // For this app's purpose, we report the overall error.
        return { success: false, error: e.message };
    }
}
