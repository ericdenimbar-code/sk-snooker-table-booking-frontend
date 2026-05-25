export const NOTIFICATION_ROLE_OPTIONS = [
  { id: 'USER', label: '普通會員 (USER)' },
  { id: 'VIP', label: 'VIP' },
  { id: 'VVIP', label: 'VVIP' },
] as const;

export type NotificationRoleId = (typeof NOTIFICATION_ROLE_OPTIONS)[number]['id'];

export const DEFAULT_VISIBLE_ROLES: NotificationRoleId[] = ['USER', 'VIP', 'VVIP'];

/** Guests on login/public pages are treated as USER for visibility checks. */
export function getEffectiveNotificationRole(
  role: string | null | undefined,
  isLoggedIn: boolean
): NotificationRoleId | null {
  if (!isLoggedIn) {
    return 'USER';
  }
  if (!role) return null;
  const normalized = role.toUpperCase();
  if (normalized === 'USER' || normalized === 'VIP' || normalized === 'VVIP') {
    return normalized;
  }
  return null;
}

export function normalizeVisibleRoles(
  visibleRoles: string[] | undefined | null
): NotificationRoleId[] {
  if (!visibleRoles || visibleRoles.length === 0) {
    return [...DEFAULT_VISIBLE_ROLES];
  }
  const allowed = new Set(DEFAULT_VISIBLE_ROLES);
  const filtered = visibleRoles
    .map((r) => r.toUpperCase())
    .filter((r): r is NotificationRoleId => allowed.has(r as NotificationRoleId));
  return filtered.length > 0 ? filtered : [...DEFAULT_VISIBLE_ROLES];
}

export function isRoleVisible(
  visibleRoles: string[] | undefined | null,
  userRole: string | null | undefined,
  isLoggedIn: boolean
): boolean {
  const roles = normalizeVisibleRoles(visibleRoles);
  const effective = getEffectiveNotificationRole(userRole, isLoggedIn);
  if (!effective) return false;
  return roles.includes(effective);
}
