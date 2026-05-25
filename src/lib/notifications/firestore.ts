import type { Timestamp } from 'firebase/firestore';
import type { NotificationBlock, SiteNotifications } from './types';
import { EMPTY_NOTIFICATION_BLOCK, DEFAULT_SITE_NOTIFICATIONS } from './types';

type FirestoreNotificationBlock = {
  content?: string;
  startTime?: Timestamp | null;
  endTime?: Timestamp | null;
  isActive?: boolean;
};

type FirestoreSiteNotifications = {
  popup?: FirestoreNotificationBlock;
  topBanner?: FirestoreNotificationBlock;
};

function timestampToDate(value: Timestamp | null | undefined): Date | null {
  if (!value || typeof value.toDate !== 'function') return null;
  const date = value.toDate();
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseBlock(raw: FirestoreNotificationBlock | undefined): NotificationBlock {
  if (!raw) return { ...EMPTY_NOTIFICATION_BLOCK };
  return {
    content: raw.content ?? '',
    startTime: timestampToDate(raw.startTime ?? undefined),
    endTime: timestampToDate(raw.endTime ?? undefined),
    isActive: raw.isActive ?? false,
  };
}

export function parseSiteNotificationsFromFirestore(
  data: FirestoreSiteNotifications | undefined | null
): SiteNotifications {
  if (!data) return { ...DEFAULT_SITE_NOTIFICATIONS };
  return {
    popup: parseBlock(data.popup),
    topBanner: parseBlock(data.topBanner),
  };
}
