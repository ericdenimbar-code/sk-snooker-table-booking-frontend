import type { NotificationBlock, SiteNotifications } from './types';

export type SerializedNotificationBlock = {
  content: string;
  startTime: string | null;
  endTime: string | null;
  isActive: boolean;
};

export type SerializedSiteNotifications = {
  popup: SerializedNotificationBlock;
  topBanner: SerializedNotificationBlock;
};

function blockToSerialized(block: NotificationBlock): SerializedNotificationBlock {
  return {
    content: block.content,
    startTime: block.startTime?.toISOString() ?? null,
    endTime: block.endTime?.toISOString() ?? null,
    isActive: block.isActive,
  };
}

function serializedToBlock(block: SerializedNotificationBlock): NotificationBlock {
  return {
    content: block.content,
    startTime: block.startTime ? new Date(block.startTime) : null,
    endTime: block.endTime ? new Date(block.endTime) : null,
    isActive: block.isActive,
  };
}

export function serializeSiteNotifications(data: SiteNotifications): SerializedSiteNotifications {
  return {
    popup: blockToSerialized(data.popup),
    topBanner: blockToSerialized(data.topBanner),
  };
}

export function deserializeSiteNotifications(
  data: SerializedSiteNotifications
): SiteNotifications {
  return {
    popup: serializedToBlock(data.popup),
    topBanner: serializedToBlock(data.topBanner),
  };
}
