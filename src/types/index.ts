
import type { firestore } from 'firebase-admin';

export type BlockedSlotsDoc = {
  /** Blocked half-hour slots for this date, e.g. ["10:00", "10:30"] */
  slots: string[];
};

export type Reservation = {
  id: string; // Ref number
  roomId: string;
  roomName: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  date: string; // 'yyyy-MM-dd'
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
  hours: number;
  costInTokens: number;
  bookingDate: string; // ISO string
  status: 'Confirmed' | 'Cancelled' | 'Pending Fps Payment'; 
  isSoloPractice?: boolean;
  qrSecret: string; // Secret code embedded in the QR code
  paymentMethod: 'tokens' | 'fps' | 'mixed'; // How the booking was paid for
  amountPaidWithTokens?: number;
  amountPaidWithFps?: number;
  expiresAt?: firestore.Timestamp; // For pending payments, use Firestore Timestamp
  /** SHA256-based Google Calendar event id (shared across room + door calendars) */
  googleCalendarEventId?: string;
  /** Door control slot used when the booking was created */
  googleCalendarDoorSlot?: '1A' | '1B' | '2A' | '2B';
  /** ISO timestamp when the booking was cancelled */
  cancelledAt?: string;
  /** Last known Google Calendar delete sync state */
  googleCalendarSyncStatus?: 'synced' | 'pending_delete' | 'delete_failed';
};

export type TemporaryAccess = {
  /** 申請紀錄 ID（Firestore 文件 ID） */
  id: string;
  userId: string;
  userEmail: string;
  validFrom: string; // ISO String
  validUntil: string; // ISO String
  status: 'active' | 'expired' | 'cancelled';
  /** 每日密鑰識別，例如 D-2026-05-14（03:00 HKT 起算） */
  segmentKey?: string;
  /** VVIP：緩衝結束後方可進場（ISO） */
  effectiveFrom?: string;
  /** VVIP：日曆同步結束（含緩衝，ISO） */
  calendarUntil?: string;
  /** 管理員：僅隱藏前端，不刪日曆 */
  adminUiDismissed?: boolean;
  /** 該時段內共用的 QR 密鑰（與 id 不同） */
  sharedSecret?: string;
  createdAt?: string;
  /** 按下申請時的伺服器時間（ISO） */
  requestedAt?: string;
  /** 收件電郵（與發送對象一致，永遠為字串） */
  recipientEmail?: string;
  /** 僅管理員：畫面顯示用香港時間區間文案 */
  displayRangeHkt?: string;
};


export type TokenPurchaseRequest = {
  id: string; // Ref number, e.g., TR-1629...
  userEmail: string;
  userName: string;
  userPhone: string;
  tokenQuantity: number;
  totalPriceHKD: number;
  status: 'requesting' | 'processing' | 'completed' | 'cancelled';
  requestDate: string; // ISO string
  paymentProofUrl: string; // URL to the uploaded image
  completionDate: string; // ISO string
  paymentMethod: 'fps' | 'bank' | 'admin_manual';
  expiresAt?: string; // ISO string for expiry, now optional
  linkedReservationId?: string; // ID of the reservation this purchase is for
  notes?: string;
  /** 自動對帳時實際入帳金額與申請金額不一致 */
  hasDiscrepancy?: boolean;
};

export type UserNotification = {
    id: string;
    title: string;
    description: string;
    timestamp: string; // ISO string
    isRead: boolean;
};

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  tokens: number;
  role: 'Admin' | 'User' | 'VIP' | 'VVIP';
  joinedDate: string;
  fpsPayerNames?: string;
};
