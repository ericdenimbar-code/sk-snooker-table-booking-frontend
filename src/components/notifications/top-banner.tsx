'use client';

import { X } from 'lucide-react';
import { useNotifications } from '@/hooks/use-notifications';
import { NotificationHtml } from './notification-html';
import { cn } from '@/lib/utils';

export function TopBanner() {
  const { showTopBanner, notifications, dismissTopBanner, isLoading } =
    useNotifications();

  if (isLoading || !showTopBanner) return null;

  return (
    <div
      className={cn(
        'fixed left-0 right-0 top-0 z-50 flex min-h-[10vh] items-center',
        'border-b border-white/10 bg-slate-900/95 px-4 py-3 text-white shadow-md backdrop-blur-sm'
      )}
      role="region"
      aria-label="網站公告"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
        <NotificationHtml
          html={notifications.topBanner.content}
          className="flex-1 text-sm text-white sm:text-base"
        />
        <button
          type="button"
          onClick={dismissTopBanner}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="關閉公告"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
