import type { Firestore } from 'firebase-admin/firestore';

const ADMIN_CONFIG_COLLECTION = 'settings';
const ADMIN_CONFIG_DOC_ID = 'admin_config';

export function parseAlertEmailsField(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .flatMap((entry) => String(entry).split(','))
      .map((e) => e.trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  }
  return [];
}

export async function fetchAdminAlertEmails(db: Firestore): Promise<string[]> {
  const snap = await db.collection(ADMIN_CONFIG_COLLECTION).doc(ADMIN_CONFIG_DOC_ID).get();
  if (!snap.exists) {
    return [];
  }
  return parseAlertEmailsField(snap.data()?.alertEmails);
}
