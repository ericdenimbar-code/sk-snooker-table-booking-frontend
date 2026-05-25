export type NotificationBlock = {
  content: string;
  startTime: Date | null;
  endTime: Date | null;
  isActive: boolean;
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
};

export const DEFAULT_SITE_NOTIFICATIONS: SiteNotifications = {
  popup: { ...EMPTY_NOTIFICATION_BLOCK },
  topBanner: { ...EMPTY_NOTIFICATION_BLOCK },
};
