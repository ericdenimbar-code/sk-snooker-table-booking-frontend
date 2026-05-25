import { DEFAULT_VISIBLE_ROLES, type NotificationRoleId } from './roles';

export type NotificationBlock = {
  content: string;
  startTime: Date | null;
  endTime: Date | null;
  isActive: boolean;
  visibleRoles: NotificationRoleId[];
};

export type SiteNotifications = {
  popup: NotificationBlock;
  topBanner: NotificationBlock;
};

export const EMPTY_NOTIFICATION_BLOCK: NotificationBlock = {
  content: '',
  startTime: null,
  endTime: null,
  isActive: false,
  visibleRoles: [...DEFAULT_VISIBLE_ROLES],
};

export const DEFAULT_SITE_NOTIFICATIONS: SiteNotifications = {
  popup: { ...EMPTY_NOTIFICATION_BLOCK },
  topBanner: { ...EMPTY_NOTIFICATION_BLOCK },
};
