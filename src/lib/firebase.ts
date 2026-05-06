
import { FirebaseApp, FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const isProduction = process.env.NODE_ENV === "production";

const getEnvValue = (baseKey: string): string | undefined => {
  // Priority:
  // 1) Explicit per-environment key (e.g. NEXT_PUBLIC_FIREBASE_API_KEY_PRD / _UAT)
  // 2) Existing generic key (e.g. NEXT_PUBLIC_FIREBASE_API_KEY)
  const envSpecificKey = isProduction ? `${baseKey}_PRD` : `${baseKey}_UAT`;
  return process.env[envSpecificKey] ?? process.env[baseKey];
};

const firebaseConfig: FirebaseOptions = {
  apiKey: getEnvValue("NEXT_PUBLIC_FIREBASE_API_KEY"),
  authDomain: getEnvValue("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
  projectId: getEnvValue("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
  storageBucket: getEnvValue("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: getEnvValue("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"),
  appId: getEnvValue("NEXT_PUBLIC_FIREBASE_APP_ID"),
};

const requiredConfigFields: Array<keyof FirebaseOptions> = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const missingFields = requiredConfigFields.filter((field) => !firebaseConfig[field]);
if (missingFields.length > 0) {
  throw new Error(
    `Firebase config is incomplete for NODE_ENV=${process.env.NODE_ENV}. Missing: ${missingFields.join(", ")}`
  );
}

const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const shouldUseEmulator = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === "true";
const emulatorState = globalThis as typeof globalThis & {
  __firebaseEmulatorConnected?: boolean;
};

if (isProduction && shouldUseEmulator) {
  throw new Error("Emulator usage is forbidden in production environment.");
}

if (shouldUseEmulator && !emulatorState.__firebaseEmulatorConnected) {
  const authHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1";
  const authPort = Number(process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_PORT ?? "9099");
  const firestoreHost = process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST ?? "127.0.0.1";
  const firestorePort = Number(process.env.NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_PORT ?? "8080");

  connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, firestoreHost, firestorePort);
  emulatorState.__firebaseEmulatorConnected = true;
}

export { app, auth, db };
