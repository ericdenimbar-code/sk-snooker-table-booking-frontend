import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';

let db: Firestore | null = null;
let auth: Auth | null = null;

const hasAdminConfig = 
  process.env.SERVICE_ACCOUNT_PROJECT_ID &&
  process.env.SERVICE_ACCOUNT_CLIENT_EMAIL &&
  process.env.SERVICE_ACCOUNT_PRIVATE_KEY;

if (hasAdminConfig && !admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.SERVICE_ACCOUNT_PROJECT_ID,
        clientEmail: process.env.SERVICE_ACCOUNT_CLIENT_EMAIL,
        privateKey: process.env.SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    
    db = admin.firestore();
    auth = admin.auth();
    console.log('Firebase Admin SDK successfully initialized.');

  } catch (error) {
    console.error("Firebase Admin SDK initialization error:", error);
  }
} else if (admin.apps.length) {
    db = admin.firestore();
    auth = admin.auth();
} else {
    console.warn("Firebase Admin SDK not initialized: Missing SERVICE_ACCOUNT environment variables.");
}

export { db, auth };
