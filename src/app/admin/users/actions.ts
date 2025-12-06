'use server';

import { revalidatePath } from 'next/cache';
import { db, auth } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

// Define the User type for consistency
export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  tokens: number;
  role: 'User' | 'VIP' | 'VVIP' | 'Admin';
  joinedDate: string;
  fpsPayerNames?: string; // New field for FPS payer identification names
};

type ServerActionResponse = {
    success: boolean;
    error?: string;
    [key: string]: any;
};


// Action to get a user by their email
export async function getUserByEmail(email: string): Promise<User | null> {
    if (!db) return null;
    try {
        const usersRef = db.collection('users');
        const querySnapshot = await usersRef.where('email', '==', email).limit(1).get();

        if (querySnapshot.empty) {
            return null;
        }

        const docSnap = querySnapshot.docs[0];
        const data = docSnap.data();
        
        return {
            id: docSnap.id,
            name: data.name || 'N/A',
            email: data.email || 'N/A',
            phone: data.phone || 'N/A',
            tokens: data.tokens ?? 0,
            role: data.role || 'User',
            joinedDate: data.joinedDate || 'N/A',
            fpsPayerNames: data.fpsPayerNames || '', // Ensure field is returned
        };
    } catch (error) {
        console.error(`Error getting user by email ${email}:`, error);
        return null;
    }
}


// Action to update a user's details
export async function updateUser(userId: string, data: Partial<Omit<User, 'id' | 'tokens' | 'joinedDate'>>): Promise<ServerActionResponse> {
  if (!db) {
    return { success: false, error: '後端資料庫未連接。' };
  }
  try {
    await db.collection('users').doc(userId).update(data);
    revalidatePath('/admin/users');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Action to adjust a user's token balance (atomic operation)
export async function adjustUserTokens(userId: string, adjustment: number): Promise<ServerActionResponse> {
  if (!db) {
     return { success: false, error: '後端資料庫未連接。' };
  }
  try {
    const userRef = db.collection('users').doc(userId);
    await userRef.update({ tokens: FieldValue.increment(adjustment) });
    revalidatePath('/admin/users');
    revalidatePath('/(main)/purchase-tokens');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Action to trigger a password reset (simulation) - Now handled by client-side Firebase Auth
export async function resetUserPassword(email: string): Promise<ServerActionResponse> {
  // This server action is no longer directly responsible for sending the email.
  // The client will use Firebase Auth SDK directly.
  console.log(`Password reset requested for: ${email}. Client will handle email dispatch.`);
  return { success: true };
}

// Action to get all users from the database
export async function getAllUsers(): Promise<ServerActionResponse> {
  if (!db) {
    return { success: false, error: '後端資料庫未連接。' };
  }
  try {
    const usersCollection = db.collection('users');
    const snapshot = await usersCollection.orderBy('name', 'asc').get();
    if (snapshot.empty) {
      return { success: true, users: [] };
    }
    const users = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            id: doc.id,
            name: data.name || 'N/A',
            email: data.email || 'N/A',
            phone: data.phone || 'N/A',
            tokens: data.tokens ?? 0,
            role: data.role || 'User',
            joinedDate: data.joinedDate || 'N/A',
            fpsPayerNames: data.fpsPayerNames || '', // Ensure field is returned
        };
    }) as User[];
    return { success: true, users };
  } catch (e: any) {
    return { success: false, error: `從資料庫讀取使用者時發生錯誤: ${e.message}` };
  }
}

// Action to create a user document in Firestore upon signup
export async function createUserInFirestore(
  userData: { id: string; email: string; name: string; phone: string }
): Promise<ServerActionResponse> {
  if (!db) {
    return { success: false, error: '後端資料庫未連接。' };
  }
  try {
    const userRef = db.collection('users').doc(userData.id);
    await userRef.set({
      email: userData.email,
      name: userData.name,
      phone: userData.phone,
      tokens: 0, // Default starting tokens
      role: 'User', // Default role
      joinedDate: new Date().toISOString().split('T')[0], // 'YYYY-MM-DD'
      fpsPayerNames: '', // Initialize with empty string
    });
    revalidatePath('/admin/users');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// Action to delete a user from Firestore and Firebase Auth
export async function deleteUser(userId: string): Promise<ServerActionResponse> {
    if (!db || !auth) {
        return { success: false, error: '後端服務未完全連接。' };
    }
    try {
        // Step 1: Delete from Firestore
        await db.collection('users').doc(userId).delete();

        // Step 2: Delete from Firebase Authentication
        await auth.deleteUser(userId);
        
        revalidatePath('/admin/users');
        return { success: true };
    } catch (e: any) {
        console.error(`Failed to delete user ${userId}:`, e);
        // Handle cases where user might not exist in Auth but does in Firestore
        if ((e as any).code === 'auth/user-not-found') {
             revalidatePath('/admin/users');
             return { success: true }; // Consider it a success if the end result is the user is gone
        }
        return { success: false, error: e.message };
    }
}
