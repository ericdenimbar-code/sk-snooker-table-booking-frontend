'use server';

import { revalidatePath } from 'next/cache';
import { closeActiveHoldForAdmin } from '@/app/(main)/new-reservation/actions';
import { db } from '@/lib/firebase-admin';
import { endActiveHoldCalendarEvents, holdCalendarActiveNow } from '@/lib/google-calendar';
import type { HoldTable } from '@/lib/blocked-slots';

const ALL_OFF_GAP_MS = 30_000;

export type HoldSwitchState = {
  table1: boolean;
  table2: boolean;
  error?: string;
};

async function requireAdmin(adminUserId: string): Promise<string | null> {
  if (!adminUserId) return '找不到管理員身分，請重新登入。';
  if (!db) return '後端資料庫未連接。';
  const adminDoc = await db.collection('users').doc(adminUserId).get();
  const role = String(adminDoc.data()?.role ?? '').toLowerCase();
  if (!adminDoc.exists || role !== 'admin') return '權限不足。';
  return null;
}

function revalidateHoldSurfaces() {
  revalidatePath('/new-reservation', 'page');
  revalidatePath('/admin/bookings', 'page');
  revalidatePath('/closedoor', 'page');
}

export async function getHoldSwitchState(adminUserId: string): Promise<HoldSwitchState & { success: boolean }> {
  const authError = await requireAdmin(adminUserId);
  if (authError) return { success: false, table1: false, table2: false, error: authError };
  const [first, second] = await Promise.all([
    holdCalendarActiveNow('1'),
    holdCalendarActiveNow('2'),
  ]);
  const error = first.error ?? second.error;
  return {
    success: !error,
    table1: first.active,
    table2: second.active,
    error,
  };
}

async function shutTable(adminUserId: string, table: HoldTable, now: Date): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const closed = await closeActiveHoldForAdmin(adminUserId, table, now);
  if (closed.status === 'failed') return { ok: false, error: closed.error || '無法關閉預留。' };
  const calendar = await endActiveHoldCalendarEvents(table, now);
  revalidateHoldSurfaces();
  if (closed.status === 'ok' || calendar.ended > 0) {
    const missedEvent = closed.status === 'ok' && closed.calendarWarning?.includes('找不到');
    const warning = calendar.ended > 0 && missedEvent ? calendar.error : (closed.status === 'ok' ? closed.calendarWarning ?? calendar.error : calendar.error);
    return { ok: true, warning };
  }
  if (calendar.error) return { ok: false, error: calendar.error };
  return { ok: false, error: closed.status === 'not-started' ? '此時段尚未開始。' : '此時段已結束。' };
}

export async function turnOffHoldTable(adminUserId: string, table: HoldTable): Promise<{ success: boolean; error?: string; warning?: string }> {
  const result = await shutTable(adminUserId, table, new Date());
  if (!result.ok && result.error !== '此時段已結束。' && result.error !== '此時段尚未開始。') {
    return { success: false, error: result.error };
  }
  return { success: result.ok, error: result.ok ? undefined : result.error, warning: result.warning };
}

export async function turnOffAllHolds(adminUserId: string): Promise<{ success: boolean; error?: string; warning?: string }> {
  const first = await shutTable(adminUserId, '1', new Date());
  if (!first.ok && first.error !== '此時段已結束。' && first.error !== '此時段尚未開始。') {
    return { success: false, error: first.error || '枱號1未能關閉。' };
  }
  await new Promise((resolve) => setTimeout(resolve, ALL_OFF_GAP_MS));
  const second = await shutTable(adminUserId, '2', new Date());
  if (!second.ok && second.error !== '此時段已結束。' && second.error !== '此時段尚未開始。') {
    return { success: false, error: second.error || '枱號1已關閉，枱號2未能關閉。', warning: first.warning };
  }
  const warning = [first.warning, second.warning].filter(Boolean).join(' ');
  const bothAlreadyDone = !first.ok && !second.ok;
  if (bothAlreadyDone) return { success: false, error: '此時段已結束。' };
  return { success: true, warning: warning || undefined };
}
