'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/lib/firebase';

export type AdminFirestoreSession = {
  ready: boolean;
  firebaseUser: FirebaseUser | null;
  uid: string | null;
  email: string | null;
  localRole: string | null;
  isAdmin: boolean;
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

export function useAdminFirestoreSession(): AdminFirestoreSession {
  const [session, setSession] = useState<AdminFirestoreSession>({
    ready: false,
    firebaseUser: null,
    uid: null,
    email: null,
    localRole: null,
    isAdmin: false,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        setSession({
          ready: true,
          firebaseUser: null,
          uid: null,
          email: null,
          localRole: null,
          isAdmin: false,
        });
        return;
      }

      const localRole = readLocalRoleForUid(firebaseUser.uid);
      setSession({
        ready: true,
        firebaseUser,
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        localRole,
        isAdmin: localRole?.toLowerCase() === 'admin',
      });
    });

    return () => unsubscribe();
  }, []);

  return session;
}
