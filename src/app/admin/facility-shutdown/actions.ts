'use server';

import {
  getFacilityShutdownSettingsForAdmin,
  rotateFacilityShutdownPasscode,
  saveFacilityShutdownSettings,
  type FacilityShutdownSettingsView,
} from '@/lib/facility-shutdown';

export type { FacilityShutdownSettingsView };

export async function getFacilityShutdownSettings(adminUserId: string) {
  return getFacilityShutdownSettingsForAdmin(adminUserId);
}

export async function saveFacilityShutdown(params: {
  adminUserId: string;
  passcode: string;
  startTime: string;
  endTime: string;
}) {
  return saveFacilityShutdownSettings(params);
}

export async function refreshFacilityShutdownPasscode(adminUserId: string) {
  return rotateFacilityShutdownPasscode(adminUserId);
}
