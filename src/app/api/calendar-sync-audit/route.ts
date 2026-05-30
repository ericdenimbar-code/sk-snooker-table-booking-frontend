import { NextResponse } from 'next/server';
import { auditCancelledReservationsCalendarSync } from '@/lib/google-calendar-audit';

/**
 * Google Calendar & Firestore Sync Audit
 * 檢查 Firestore 中已取消的預約，並確保 Google Calendar 上的對應日程已被刪除。
 * 若發現殘留日程，請將其從 Google Calendar 中移除。
 *
 * Vercel Cron: hourly (0 * * * *)
 * Requires Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await auditCancelledReservationsCalendarSync();
    console.log('[Calendar Sync Audit]', result);

    return NextResponse.json({
      title: 'Google Calendar & Firestore Sync Audit',
      ...result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Calendar Sync Audit] failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
