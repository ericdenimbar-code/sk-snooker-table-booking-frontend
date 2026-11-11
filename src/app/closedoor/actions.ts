'use server';

import { db } from '@/lib/firebase-admin';
import { closeHoldByPasscode } from '@/app/(main)/new-reservation/actions';

export async function getPublicSiteName(): Promise<string> {
  const fallback = 'Snooker Kingdom Booking';
  if (!db) return fallback;
  try {
    const snap = await db.collection('roomSettings').doc('1').get();
    const name = snap.data()?.siteBranding?.name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  } catch (error: unknown) {
    console.error('[closedoor] site name', error);
  }
  return fallback;
}

export async function submitClosedoorPasscode(passcode: string): Promise<
  | { status: 'ok'; message: string }
  | { status: 'invalid' | 'locked' | 'not-started' | 'ended' | 'failed'; message: string }
> {
  try {
    const result = await closeHoldByPasscode(passcode);
    if (result.status === 'ok') {
      return {
        status: 'ok',
        message: `謝謝您的光臨，${result.table}號枱即將關閉，請檢查你的隨身物品有否遺留，期待你下次光臨。`,
      };
    }
    if (result.status === 'locked') return { status: 'locked', message: '嘗試次數過多，請 15 分鐘後再試。' };
    if (result.status === 'not-started') return { status: 'not-started', message: '此時段尚未開始。' };
    if (result.status === 'ended') return { status: 'ended', message: '此時段已結束。' };
    if (result.status === 'failed') return { status: 'failed', message: result.error || '暫時無法結束預留，請稍後再試。' };
    return { status: 'invalid', message: '密碼不正確。' };
  } catch (error: unknown) {
    console.error('[closedoor] close hold', error);
    return { status: 'failed', message: '暫時無法結束預留，請稍後再試。' };
  }
}
