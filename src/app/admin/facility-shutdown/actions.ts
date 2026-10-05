'use server';

import {
  cancelFacilityShutdownSettings,
  getFacilityShutdownSettingsForAdmin,
  rotateFacilityShutdownPasscode,
  saveFacilityShutdownSettings,
  type FacilityShutdownLogView,
  type FacilityShutdownSettingsView,
} from '@/lib/facility-shutdown';

export type { FacilityShutdownLogView, FacilityShutdownSettingsView };

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

export async function cancelFacilityShutdown(adminUserId: string) {
  return cancelFacilityShutdownSettings(adminUserId);
}
