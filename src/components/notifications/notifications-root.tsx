'use client';

import type { ReactNode } from 'react';
import { NotificationsProvider, useNotifications } from '@/hooks/use-notifications';
import { TopBanner } from './top-banner';
import { SessionPopup } from './session-popup';
import { cn } from '@/lib/utils';

function NotificationLayout({ children }: { children: ReactNode }) {
  const { showTopBanner } = useNotifications();

  return (
    <>
      <TopBanner />
      <div className={cn(showTopBanner && 'pt-[10vh]')}>{children}</div>
      <SessionPopup />
    </>
  );
}

export function NotificationsRoot({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <NotificationLayout>{children}</NotificationLayout>
    </NotificationsProvider>
  );
}
