'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getUserByEmail } from '@/app/admin/users/actions';
import { Loader2 } from 'lucide-react';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // User is logged in, determine where to redirect
        try {
          const userProfile = await getUserByEmail(user.email || '');
          if (userProfile?.role === 'Admin') {
            router.replace('/admin');
          } else {
            router.replace('/new-reservation');
          }
        } catch (error) {
          // Fallback if profile fetch fails
          console.error("Failed to fetch user profile, redirecting to login.", error);
          router.replace('/login');
        }
      } else {
        // User is not logged in
        router.replace('/login');
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-muted-foreground">正在載入...</p>
      </div>
    </div>
  );
}
