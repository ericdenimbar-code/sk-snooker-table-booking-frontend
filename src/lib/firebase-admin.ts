
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';

let db: Firestore | null = null;
let auth: Auth | null = null;

// --- Enhanced Debugging and Error Handling ---
console.log('--- [DEBUG] Checking Firebase Admin SDK environment variables ---');
const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

console.log(`[DEBUG] FIREBASE_PROJECT_ID: ${projectId ? 'Loaded' : 'MISSING!'}`);
console.log(`[DEBUG] FIREBASE_CLIENT_EMAIL: ${clientEmail ? 'Loaded' : 'MISSING!'}`);
console.log(`[DEBUG] FIREBASE_PRIVATE_KEY: ${privateKey ? 'Loaded' : 'MISSING!'}`);
// --- End of Enhanced Debugging ---

const hasAdminConfig = projectId && clientEmail && privateKey;

// Initialize the app only if the config is available and no app is already initialized.
if (hasAdminConfig && !admin.apps.length) {
  try {
    // **KEY FIX**: Automatically replace escaped newlines ('\\n') with actual newlines ('\n').
    // This makes the key format in the .env file more flexible and robust.
    const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: projectId,
        clientEmail: clientEmail,
        privateKey: formattedPrivateKey,
      }),
    });
    
    // If initialization is successful, get the Firestore and Auth instances.
    db = admin.firestore();
    auth = admin.auth();
    console.log('✅ Firebase Admin SDK successfully initialized.');

  } catch (error) {
    // --- THIS IS THE CRITICAL CHANGE ---
    // Instead of letting the app crash, we log the detailed error and continue.
    // This allows the application to run in a "disconnected" state.
    console.error("❌ Firebase Admin SDK initialization error:", error);
    console.warn("⚠️ Application will run in a disconnected state. Backend features will be unavailable.");
    // db and auth will remain null.
  }
} else if (admin.apps.length) {
    // If the app is already initialized, just get the instances.
    db = admin.firestore();
    auth = admin.auth();
} else {
    // This will be logged if hasAdminConfig is false.
    console.warn("⚠️ Firebase Admin SDK not initialized because one or more environment variables are missing.");
}

export { db, auth };
