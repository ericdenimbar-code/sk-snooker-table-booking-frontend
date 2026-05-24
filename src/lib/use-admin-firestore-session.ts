'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export type AdminFirestoreSession = {
  ready: boolean;
  /** Firebase Auth 使用者；監聽前須確認存在 */
  user: FirebaseUser | null;
  firebaseUser: FirebaseUser | null;
  uid: string | null;
  email: string | null;
  localRole: string | null;
  isAdmin: boolean;
  /** ID token 已就緒，Firestore 規則可讀取 admin 資料 */
  authTokenReady: boolean;
};

function readLocalRoleForUid(uid: string): string | null {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; role?: string };
    if (parsed.id !== uid) return null;
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

const emptySession: AdminFirestoreSession = {
  ready: false,
  user: null,
  firebaseUser: null,
  uid: null,
  email: null,
  localRole: null,
  isAdmin: false,
  authTokenReady: false,
};

export function useAdminFirestoreSession(): AdminFirestoreSession {
  const [session, setSession] = useState<AdminFirestoreSession>(emptySession);

  useEffect(() => {
    let activeUid: string | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        activeUid = null;
        setSession({
          ready: true,
          user: null,
          firebaseUser: null,
          uid: null,
          email: null,
          localRole: null,
          isAdmin: false,
          authTokenReady: false,
        });
        return;
      }

      const uid = firebaseUser.uid;
      activeUid = uid;
      const localRole = readLocalRoleForUid(uid);
      const isAdmin = localRole?.toLowerCase() === 'admin';

      setSession({
        ready: true,
        user: firebaseUser,
        firebaseUser,
        uid,
        email: firebaseUser.email,
        localRole,
        isAdmin,
        authTokenReady: false,
      });

      if (!isAdmin) {
        return;
      }

      try {
        await firebaseUser.getIdToken();
        if (activeUid !== uid) return;
        setSession((prev) =>
          prev.uid === uid ? { ...prev, authTokenReady: true } : prev,
        );
      } catch (err) {
        console.warn('[admin] getIdToken failed before Firestore listen', err);
        if (activeUid === uid) {
          setSession((prev) =>
            prev.uid === uid ? { ...prev, authTokenReady: false } : prev,
          );
        }
      }
    });

    return () => {
      activeUid = null;
      unsubscribe();
    };
  }, []);

  return session;
}
