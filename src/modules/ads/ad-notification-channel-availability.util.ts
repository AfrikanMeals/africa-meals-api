import type { NotificationAddonPayload } from '@modules/ads/ad-notification.util';
import { EMPTY_NOTIFICATION_ADDON } from '@modules/ads/ad-notification.util';
import { AdNotificationChannelsModel } from '@schemas/ad-notification-addon.schema';

export type AdNotificationChannelAvailability = {
  email: boolean;
  push: boolean;
  inApp: boolean;
  sms: boolean;
  whatsapp: boolean;
};

export const DEFAULT_CHANNEL_AVAILABILITY: AdNotificationChannelAvailability = {
  email: true,
  push: true,
  inApp: true,
  sms: true,
  whatsapp: true,
};

export function parseAvailableChannelsFromDoc(
  doc: Record<string, unknown> | null | undefined,
): AdNotificationChannelAvailability {
  const raw =
    (doc?.availableChannels as Record<string, unknown> | undefined) ??
    (doc?.available_channels as Record<string, unknown> | undefined);
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CHANNEL_AVAILABILITY };
  }
  return {
    email: raw.email !== false,
    push: raw.push !== false,
    inApp: raw.inApp !== false && raw.in_app !== false,
    sms: raw.sms !== false,
    whatsapp: raw.whatsapp !== false,
  };
}

export function applyChannelAvailabilityToAddon(
  addon: NotificationAddonPayload,
  available: AdNotificationChannelAvailability,
): NotificationAddonPayload {
  const channels = {
    email: addon.channels.email && available.email,
    push: addon.channels.push && available.push,
    inApp: addon.channels.inApp && available.inApp,
    sms: addon.channels.sms && available.sms,
    whatsapp: addon.channels.whatsapp && available.whatsapp,
  };
  const anyChannel = Object.values(channels).some(Boolean);
  return {
    enabled: addon.enabled && anyChannel,
    channels: anyChannel ? channels : { ...EMPTY_NOTIFICATION_ADDON.channels },
  };
}

export function availabilityFromChannelsModel(
  model?: AdNotificationChannelsModel | null,
): AdNotificationChannelAvailability {
  if (!model) return { ...DEFAULT_CHANNEL_AVAILABILITY };
  return parseAvailableChannelsFromDoc({
    availableChannels: model as unknown as Record<string, unknown>,
  });
}
