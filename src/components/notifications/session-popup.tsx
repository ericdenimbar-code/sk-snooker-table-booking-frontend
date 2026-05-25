'use client';

import { X } from 'lucide-react';
import { useNotifications } from '@/hooks/use-notifications';
import { NotificationHtml } from './notification-html';
import { cn } from '@/lib/utils';

export function SessionPopup() {
  const { showPopup, notifications, dismissPopup, isLoading } = useNotifications();

  if (isLoading || !showPopup) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="公告"
    >
      <div
        className={cn(
          'relative flex w-full flex-col bg-background shadow-2xl',
          'max-md:h-full max-md:max-w-none max-md:rounded-none',
          'md:max-h-[85vh] md:max-w-lg md:rounded-2xl md:border md:border-white/10'
        )}
      >
        <button
          type="button"
          onClick={dismissPopup}
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 md:right-4 md:top-4"
          aria-label="關閉"
        >
          <X className="h-6 w-6" />
        </button>

        <div className="flex flex-1 flex-col overflow-y-auto p-6 pt-14 md:p-8 md:pt-16">
          <NotificationHtml
            html={notifications.popup.content}
            className="text-base text-foreground/90"
          />
          <button
            type="button"
            onClick={dismissPopup}
            className="mt-8 w-full rounded-full bg-primary py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
