
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
};

export type TemporaryAccess = {
  id: string; // Same as qrSecret for simplicity
  userId: string;
  userEmail: string;
  validFrom: string; // ISO String
  validUntil: string; // ISO String
  status: 'active' | 'expired' | 'cancelled';
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
};

export type UserNotification = {
    id: string;
    title: string;
    description: string;
    timestamp: string; // ISO string
    isRead: boolean;
};
