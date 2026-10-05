'use server';

import { db } from '@/lib/firebase-admin';
import {
  isFacilityShutdownWindowOpen,
  triggerFacilityShutdown,
  verifyFacilityShutdownPasscode,
  type FacilityShutdownPublicStatus,
} from '@/lib/facility-shutdown';

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

/** 只回傳現在是否在生效時段內。 */
export async function getClosedoorAvailability(): Promise<{ open: boolean }> {
  try {
    return { open: await isFacilityShutdownWindowOpen() };
  } catch (error: unknown) {
    console.error('[closedoor] availability', error);
    return { open: false };
  }
}

export async function submitClosedoorPasscode(passcode: string): Promise<
  { status: 'ok'; ticket: string } | { status: 'closed' | 'invalid' }
> {
  try {
    return await verifyFacilityShutdownPasscode(passcode);
  } catch (error: unknown) {
    console.error('[closedoor] verify', error);
    return { status: 'invalid' };
  }
}

export async function confirmClosedoorShutdown(ticket: string): Promise<{ status: FacilityShutdownPublicStatus }> {
  try {
    return { status: await triggerFacilityShutdown(ticket) };
  } catch (error: unknown) {
    console.error('[closedoor] trigger', error);
    return { status: 'failed' };
  }
}
