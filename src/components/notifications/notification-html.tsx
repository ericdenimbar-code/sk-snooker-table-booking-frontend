'use client';

import { sanitizeNotificationHtml } from '@/lib/notifications/sanitize';
import { cn } from '@/lib/utils';

type NotificationHtmlProps = {
  html: string;
  className?: string;
};

export function NotificationHtml({ html, className }: NotificationHtmlProps) {
  const safeHtml = sanitizeNotificationHtml(html);

  if (!safeHtml) return null;

  return (
    <div
      className={cn(
        'leading-relaxed [&_strong]:font-bold [&_b]:font-bold [&_em]:italic [&_i]:italic [&_u]:underline',
        className
      )}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
