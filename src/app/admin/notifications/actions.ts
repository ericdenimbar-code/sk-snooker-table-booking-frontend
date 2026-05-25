'use server';

import { db } from '@/lib/firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { unstable_noStore as noStore } from 'next/cache';
import type { NotificationBlock, SiteNotifications } from '@/lib/notifications/types';
import { DEFAULT_SITE_NOTIFICATIONS } from '@/lib/notifications/types';
import { parseSiteNotificationsFromFirestore } from '@/lib/notifications/firestore';
import {
  serializeSiteNotifications,
  deserializeSiteNotifications,
  type SerializedSiteNotifications,
} from '@/lib/notifications/serialize';

export type { SerializedSiteNotifications, SerializedNotificationBlock } from '@/lib/notifications/serialize';

function adminBlockToFirestore(block: NotificationBlock) {
  return {
    content: block.content,
    startTime: block.startTime ? Timestamp.fromDate(block.startTime) : null,
    endTime: block.endTime ? Timestamp.fromDate(block.endTime) : null,
    isActive: block.isActive,
  };
}

export async function getSiteNotifications(): Promise<SiteNotifications> {
  noStore();
  if (!db) return { ...DEFAULT_SITE_NOTIFICATIONS };

  try {
    const docSnap = await db.collection('settings').doc('notifications').get();
    if (!docSnap.exists) {
      return { ...DEFAULT_SITE_NOTIFICATIONS };
    }
    return parseSiteNotificationsFromFirestore(docSnap.data());
  } catch (e) {
    console.error('getSiteNotifications failed:', e);
    return { ...DEFAULT_SITE_NOTIFICATIONS };
  }
}

export async function getSiteNotificationsSerialized(): Promise<SerializedSiteNotifications> {
  const data = await getSiteNotifications();
  return serializeSiteNotifications(data);
}

export async function publishSiteNotifications(
  data: SerializedSiteNotifications
): Promise<{ success: boolean; error?: string }> {
  if (!db) return { success: false, error: '後端資料庫未連接。' };

  try {
    const parsed = deserializeSiteNotifications(data);
    await db.collection('settings').doc('notifications').set(
      {
        popup: adminBlockToFirestore(parsed.popup),
        topBanner: adminBlockToFirestore(parsed.topBanner),
      },
      { merge: true }
    );
    return { success: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '未知錯誤';
    return { success: false, error: message };
  }
}
