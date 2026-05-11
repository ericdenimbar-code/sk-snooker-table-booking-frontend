'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/firebase-admin';
import { parseAlertEmailsField } from '@/lib/admin-config-firestore';

const SETTINGS_COLLECTION = 'settings';
const ADMIN_CONFIG_DOC_ID = 'admin_config';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

type ServerActionResponse = {
  success: boolean;
  error?: string;
  emails?: string[];
};

export async function getAdminAlertEmailsAction(): Promise<ServerActionResponse> {
  if (!db) {
    return { success: false, error: '後端資料庫未連接。' };
  }
  try {
    const snap = await db.collection(SETTINGS_COLLECTION).doc(ADMIN_CONFIG_DOC_ID).get();
    if (!snap.exists) {
      return { success: true, emails: [] };
    }
    const emails = parseAlertEmailsField(snap.data()?.alertEmails);
    return { success: true, emails };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function saveAdminAlertEmailsAction(rawEmails: string[]): Promise<ServerActionResponse> {
  if (!db) {
    return { success: false, error: '後端資料庫未連接。' };
  }
  const normalized = rawEmails.map((e) => e.trim()).filter(Boolean);
  const invalid = normalized.filter((e) => !isValidEmail(e));
  if (invalid.length > 0) {
    return { success: false, error: `以下電郵格式不正確：${invalid.join(', ')}` };
  }
  try {
    await db
      .collection(SETTINGS_COLLECTION)
      .doc(ADMIN_CONFIG_DOC_ID)
      .set({ alertEmails: normalized }, { merge: true });
    revalidatePath('/admin/token-requests');
    return { success: true, emails: normalized };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
