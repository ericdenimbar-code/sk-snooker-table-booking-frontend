
'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { db } from '@/lib/firebase-admin';
import { unstable_cache as cache } from 'next/cache';

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

export type PaymentInfo = {
  bankDetails: string;
  fpsNumber: string;
};

export type SiteBranding = {
  name: string;
  logoUrl: string; // Can store a Data URL
};

// Room-specific settings
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


// --- Default Data Generation ---
const generateDefaultSlotData = (): SlotData[] => {
  const getEndTime = (startTime: string) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + 30;
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  };

  return Array.from({ length: 48 }, (_, i) => {
    const hours = Math.floor(i / 2);
    const minutes = (i % 2) * 30;
    const startTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    
    let cost = 50; // Default price
    if (hours >= 18 && hours < 23) cost = 80; // Peak hours
    else if (hours < 7) cost = 40; // Night hours

    return { 
      id: i, 
      timeLabel: `${startTime} - ${getEndTime(startTime)}`, 
      startTime: startTime,
      cost,
    };
  });
};

const createDefaultSettings = (roomId: '1' | '2'): Omit<RoomSettings, 'id'> => {
  const roomName = `枱號${roomId}`;
  return {
    name: roomName,
    tokenPriceHKD: 1,
    slotCostsData: generateDefaultSlotData(),
    termsAndConditions: `請詳細閱讀以下條款及細則：

1.  **預約與付款：** 所有預約均需使用帳戶餘額支付。確認預約後，相應的款項將立即從您的帳戶中扣除。請確保您的帳戶有足夠的餘額。

2.  **取消政策：** 如需取消預約，必須在預約開始時間的 24 小時前完成。在 24 小時内取消或未出席（No-show），已支付的款項將不予退還。

3.  **使用規則：**
    *   請準時開始並結束您的預約時段，以免影響下一位使用者。
    *   使用後請保持場地整潔。
    *   場地內的任何設備如有損壞，使用者需照價賠償。

4.  **責任聲明：** 本公司對於使用者遺留的任何個人物品概不負責。

按下「確認付款」即表示您已閱讀、理解並同意以上所有條款及細則。`,
    purchaseTokensIntro: `歡迎使用 Snooker Kingdom Booking 帳戶增值系統！帳戶餘額可以用於預訂我們的任何設施。

**增值流程如下：**

1.  **輸入金額**：在下方的增值区塊中，輸入您想增值的港幣金額。
2.  **確認總額**：系統會為您即時計算所需支付的港幣總額。
3.  **選擇方式**：目前，請選擇「聯絡管理員增值」作為您的付款方式。
4.  **送出請求**：點擊「確定」送出您的增值請求。
5.  **完成交易**：我們的管理團隊將在收到您的請求後，盡快透過電郵與您聯繫，並提供詳細的付款指引（例如：轉數快 FPS 或銀行轉帳）。您的帳戶餘額將在確認收款後，立即更新。

如有任何疑問，歡迎隨時与我們聯絡。感謝您的支持！`,
    contactInfo: {
      name: 'Snooker Kingdom 客戶服務部',
      email: 'contact@sk-booking.com',
      whatsapp: '85212345678',
      address: '香港九龍尖沙咀彌敦道132號',
      additionalInfo: '歡迎查詢。',
    },
    siteBranding: {
      name: 'Snooker Kingdom Booking',
      logoUrl: '',
    },
    selectRoomPage: {
        title: '選擇枱號',
        description: '請選擇您想要預訂的桌球枱。',
        room1ImageUrl: '',
        room2ImageUrl: '',
    },
    newReservationPage: {
        title: `新增預訂`,
        description: '請選擇日期，然後點選開始及結束時段以選取一個範圍。',
        pricingTiers: [
          {
            title: '凌晨時段',
            timeRange: '00:00-07:00',
            price: 'HKD 40/hr',
          },
          {
            title: '日間時段',
            timeRange: '07:00-18:00',
            price: 'HKD 50/hr',
          },
          {
            title: '黃金時段',
            timeRange: '18:00-23:00',
            price: 'HKD 80/hr',
          },
        ],
    },
  }
};

// --- Server Actions ---

// --- Room-specific Settings ---
export const getRoomSettings = cache(
  async (roomId: string): Promise<RoomSettings | null> => {
    if (!db) return null;
    if (roomId !== '1' && roomId !== '2') return null;

    const defaultSettings = createDefaultSettings(roomId as '1' | '2');

    try {
        const docRef = db.collection('roomSettings').doc(roomId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            const existingData = docSnap.data() || {};
            const mergedSettings = {
                ...defaultSettings,
                ...existingData,
                newReservationPage: {
                    ...defaultSettings.newReservationPage,
                    ...(existingData.newReservationPage || {}),
                    pricingTiers: (existingData.newReservationPage?.pricingTiers) ? [
                        {...defaultSettings.newReservationPage.pricingTiers[0], ...existingData.newReservationPage.pricingTiers[0]},
                        {...defaultSettings.newReservationPage.pricingTiers[1], ...existingData.newReservationPage.pricingTiers[1]},
                        {...defaultSettings.newReservationPage.pricingTiers[2], ...existingData.newReservationPage.pricingTiers[2]},
                    ] : defaultSettings.newReservationPage.pricingTiers,
                },
                contactInfo: { ...defaultSettings.contactInfo, ...(existingData.contactInfo || {}) },
                siteBranding: { ...defaultSettings.siteBranding, ...(existingData.siteBranding || {}) },
                selectRoomPage: { ...defaultSettings.selectRoomPage, ...(existingData.selectRoomPage || {}) },
            };
            return { id: docSnap.id, ...mergedSettings } as RoomSettings;
        } else {
            await docRef.set(defaultSettings);
            return { id: roomId, ...defaultSettings };
        }
    } catch (error) {
        console.error(`Error getting/creating settings for room ${roomId}:`, error);
        return null;
    }
  },
  ['room-settings'], { tags: ['room-settings'], revalidate: 3600 }
);

export async function updateRoomSettings(roomId: string, data: Partial<Omit<RoomSettings, 'id'>>): Promise<{success: boolean, error?: string}> {
    if (!db) return { success: false, error: '後端資料庫未連接。'};
    try {
        await db.collection('roomSettings').doc(roomId).set(data, { merge: true });
        revalidateTag('room-settings');
        revalidatePath('/admin', 'layout');
        revalidatePath('/(main)', 'layout');
        return { success: true };
    } catch (e: any) {
        console.error(`Failed to update settings for room ${roomId}:`, e);
        return { success: false, error: e.message };
    }
}

// --- Global HA Settings ---
const HA_SETTINGS_DOC_ID = 'ha_settings';

export const getHASettings = cache(
  async (): Promise<HASettings> => {
    const defaultSettings: HASettings = { url: '', webhookId: '' };
    if (!db) return defaultSettings;
    
    try {
        const docRef = db.collection('globalSettings').doc(HA_SETTINGS_DOC_ID);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            return { ...defaultSettings, ...docSnap.data() } as HASettings;
        } else {
            await docRef.set(defaultSettings);
            return defaultSettings;
        }
    } catch (error) {
        console.error("Error getting HA settings:", error);
        return defaultSettings;
    }
  },
  ['ha-settings'], { tags: ['ha-settings'], revalidate: 3600 }
);

export async function updateHASettings(data: HASettings): Promise<{success: boolean, error?: string}> {
  if (!db) return { success: false, error: '後端資料庫未連接。'};
  try {
    await db.collection('globalSettings').doc(HA_SETTINGS_DOC_ID).set(data, { merge: true });
    revalidateTag('ha-settings');
    revalidatePath('/admin');
    return { success: true };
  } catch (e: any) {
    console.error(`Failed to update HA settings:`, e);
    return { success: false, error: e.message };
  }
}

// --- Global Payment Settings ---
const PAYMENT_INFO_DOC_ID = 'payment_info';

export const getPaymentInfo = cache(
  async (): Promise<PaymentInfo> => {
    const defaultSettings: PaymentInfo = { bankDetails: '請在此處輸入您的銀行轉帳資訊 (例如：銀行名稱、戶口號碼、戶口持有人姓名)。使用者在增值後會看到此段文字。', fpsNumber: '' };
    if (!db) return defaultSettings;

    try {
      const docRef = db.collection('globalSettings').doc(PAYMENT_INFO_DOC_ID);
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        return { ...defaultSettings, ...docSnap.data() } as PaymentInfo;
      } else {
        await docRef.set(defaultSettings);
        return defaultSettings;
      }
    } catch (error) {
      console.error("Error getting Payment Info:", error);
      return defaultSettings;
    }
  },
  ['payment-info'], { tags: ['payment-info'], revalidate: 3600 }
);

export async function updatePaymentInfo(data: PaymentInfo): Promise<{success: boolean, error?: string}> {
  if (!db) return { success: false, error: '後端資料庫未連接。' };
  try {
    await db.collection('globalSettings').doc(PAYMENT_INFO_DOC_ID).set(data, { merge: true });
    revalidateTag('payment-info');
    revalidatePath('/admin/settings');
    return { success: true };
  } catch (e: any) {
    console.error(`Failed to update Payment Info:`, e);
    return { success: false, error: e.message };
  }
}
