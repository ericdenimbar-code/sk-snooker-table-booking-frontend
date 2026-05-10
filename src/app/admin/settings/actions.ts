
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

// --- Default template (Firestore bootstrap) ---

/** 48 × 30 分鐘時段（00:00–23:30），與 `reservation-client-page` 一致 */
function defaultSlotCostsData(): SlotData[] {
  return Array.from({ length: 48 }, (_, i) => {
    const hours = Math.floor(i / 2);
    const minutes = (i % 2) * 30;
    const startTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    return { id: i + 1, timeLabel: startTime, startTime, cost: 0 };
  });
}

const defaultPricingTiers: [PricingTier, PricingTier, PricingTier] = [
  { title: '價格區間一', timeRange: '請於後台編輯', price: '$0' },
  { title: '價格區間二', timeRange: '請於後台編輯', price: '$0' },
  { title: '價格區間三', timeRange: '請於後台編輯', price: '$0' },
];

function getDefaultRoomSettingsTemplate(roomId: string): RoomSettings {
  const roomLabel =
    roomId === '1' ? '房間 1' : roomId === '2' ? '房間 2' : `房間 ${roomId}`;
  return {
    id: roomId,
    name: roomLabel,
    tokenPriceHKD: 1,
    slotCostsData: defaultSlotCostsData(),
    termsAndConditions:
      '請於管理後台「價目及內容設定」編輯本房的預約條款及細則。首次部署時已由系統自動建立預設文件。',
    purchaseTokensIntro:
      '請於管理後台「價目及內容設定」編輯帳戶增值流程簡介。首次部署時已由系統自動建立預設文件。',
    contactInfo: {
      name: '',
      email: '',
      whatsapp: '',
      address: '',
      additionalInfo: '',
    },
    siteBranding: {
      name: 'Snooker Kingdom Booking',
      logoUrl: '',
    },
    selectRoomPage: {
      title: '選擇枱號',
      description: '請於後台編輯此頁標題與描述，並設定各房相片。',
      room1ImageUrl: '',
      room2ImageUrl: '',
    },
    newReservationPage: {
      title: `新增預訂 (${roomLabel})`,
      description: '請於後台編輯本頁內容與價目表區塊。',
      pricingTiers: defaultPricingTiers.map((t) => ({ ...t })) as [PricingTier, PricingTier, PricingTier],
    },
  };
}

/** 將預設 `RoomSettings` 寫入 Firestore（等同首次建立地基） */
export async function initializeDefaultSettings(roomId: string): Promise<RoomSettings | null> {
  if (!db) return null;
  const payload = getDefaultRoomSettingsTemplate(roomId);
  try {
    await db.collection('roomSettings').doc(roomId).set(payload);
  } catch (e: unknown) {
    console.error(`initializeDefaultSettings(set) failed for room ${roomId}:`, e);
    return null;
  }
  try {
    revalidatePath('/admin/settings');
    revalidatePath('/(main)', 'layout');
  } catch (e: unknown) {
    console.warn(`revalidatePath after room bootstrap (${roomId}) skipped:`, e);
  }
  return payload;
}

// --- Server Actions ---

export async function getRoomSettings(roomId: string): Promise<RoomSettings | null> {
  if (!db) return null;
  try {
    const docRef = db.collection('roomSettings').doc(roomId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      let created = await initializeDefaultSettings(roomId);
      if (!created) {
        const retry = await docRef.get();
        if (retry.exists) {
          created = retry.data() as RoomSettings;
        }
      }
      return created;
    }
    return docSnap.data() as RoomSettings;
  } catch (e: unknown) {
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

