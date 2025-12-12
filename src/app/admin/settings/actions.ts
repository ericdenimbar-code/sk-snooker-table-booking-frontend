
'use server';

import { db } from '@/lib/firebase-admin';
import { revalidatePath } from 'next/cache';

// --- Data Types ---
export type PricingTier = {
  title: string;
  timeRange: string;
  price: string;
};

export type NewReservationPageContent = {
  title:string;
  description: string;
  pricingTiers: [PricingTier, PricingTier, PricingTier];
};

export type SelectRoomPageContent = {
  title: string;
  description: string;
  room1ImageUrl: string;
  room2ImageUrl: string;
};

export type SlotData = {
  id: number;
  timeLabel: string;
  startTime: string;
  cost: number;
};

export type ContactInfo = {
  name: string;
  email: string;
  whatsapp: string;
  address: string;
  additionalInfo: string;
};

// Merged PaymentInfo with more email server details
export type PaymentInfo = {
  bankName: string;
  accountHolderName: string;
  fpsNumber: string;
  staticFpsQrCodeUrl: string; // New field for the static QR code image
  emailServerHost: string;
  emailServerPort: string;
  emailServerUser: string;
  emailServerPassword?: string; // Password is now optional on the type for safety
  emailFromName: string;
};

export type SiteBranding = {
  name: string;
  logoUrl: string;
};

export type RoomSettings = {
  id: string;
  name: string;
  tokenPriceHKD: number;
  slotCostsData: SlotData[];
  termsAndConditions: string;
  purchaseTokensIntro: string;
  contactInfo: ContactInfo;
  siteBranding: SiteBranding;
  selectRoomPage: SelectRoomPageContent;
  newReservationPage: NewReservationPageContent;
};

export type HASettings = {
  url: string;
  webhookId: string;
};

// --- Server Actions ---

export async function getRoomSettings(roomId: string): Promise<RoomSettings | null> {
    if (!db) return null;
    try {
        const docRef = db.collection('roomSettings').doc(roomId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            return docSnap.data() as RoomSettings;
        }
        return null;
    } catch (e: any) {
        console.error(`Error getting room settings for room ${roomId}:`, e);
        return null;
    }
}

export async function updateRoomSettings(roomId: string, data: Partial<Omit<RoomSettings, 'id'>>): Promise<{success: boolean, error?: string}> {
  if (!db) return { success: false, error: '後端資料庫未連接。' };
  try {
    await db.collection('roomSettings').doc(roomId).set(data, { merge: true });
    revalidatePath('/admin/settings');
    revalidatePath('/(main)', 'layout');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getHASettings(): Promise<HASettings> {
    if (!db) return { url: '', webhookId: '' };
    try {
        const docRef = db.collection('globalSettings').doc('ha_settings');
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return docSnap.data() as HASettings;
        }
        return { url: '', webhookId: '' };
    } catch (e: any) {
        console.error("Error getting HA settings:", e);
        return { url: '', webhookId: '' };
    }
}

export async function updateHASettings(data: HASettings): Promise<{success: boolean, error?: string}> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        await db.collection('globalSettings').doc('ha_settings').set(data, { merge: true });
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getPaymentInfo(): Promise<PaymentInfo> {
    if (!db) return { bankName: '', accountHolderName: '', fpsNumber: '', staticFpsQrCodeUrl: '', emailServerHost: '', emailServerPort: '', emailServerUser: '', emailFromName: '' };
    try {
        const docRef = db.collection('globalSettings').doc('payment_info');
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return docSnap.data() as PaymentInfo;
        }
        return { bankName: '', accountHolderName: '', fpsNumber: '', staticFpsQrCodeUrl: '', emailServerHost: 'smtp.gmail.com', emailServerPort: '587', emailServerUser: '', emailFromName: 'Snooker Kingdom Booking' };
    } catch(e) {
        console.error("Error getting payment info:", e);
        return { bankName: '', accountHolderName: '', fpsNumber: '', staticFpsQrCodeUrl: '', emailServerHost: '', emailServerPort: '', emailServerUser: '', emailFromName: '' };
    }
}

export async function updatePaymentInfo(data: Partial<PaymentInfo>): Promise<{success: boolean, error?: string}> {
    if (!db) return { success: false, error: '後端資料庫未連接。' };
    try {
        const docRef = db.collection('globalSettings').doc('payment_info');
        // If password is empty or undefined, don't update it to prevent overwriting with an empty value
        const { emailServerPassword, ...restOfData } = data;
        const updateData: Partial<PaymentInfo> = { ...restOfData };
        if(emailServerPassword) {
            updateData.emailServerPassword = emailServerPassword;
        }
        
        await docRef.set(updateData, { merge: true });
        return { success: true };
    } catch(e: any) {
        return { success: false, error: e.message };
    }
}

