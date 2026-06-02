import {
  applyChannelAvailabilityToAddon,
  type AdNotificationChannelAvailability,
  DEFAULT_CHANNEL_AVAILABILITY,
} from '@modules/ads/ad-notification-channel-availability.util';
import { NotificationAddonDto } from '@modules/ads/dto/ad-notification.dto';
import { AdNotificationAddonModel } from '@schemas/ad-notification-addon.schema';

export type NotificationAddonPayload = {
  enabled: boolean;
  channels: {
    email: boolean;
    push: boolean;
    inApp: boolean;
    sms: boolean;
    whatsapp: boolean;
  };
};

export const EMPTY_NOTIFICATION_ADDON: NotificationAddonPayload = {
  enabled: false,
  channels: {
    email: false,
    push: false,
    inApp: false,
    sms: false,
    whatsapp: false,
  },
};

export function normalizeAudienceTotal(
  value: number | null | undefined,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function audienceTotalFromDoc(
  doc: Record<string, unknown>,
): number | null {
  const raw = doc.audienceTotal ?? doc.audience_total;
  if (raw == null || raw === '') return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function normalizeNotificationAddonInput(
  dto?: NotificationAddonDto | null,
  available: AdNotificationChannelAvailability = DEFAULT_CHANNEL_AVAILABILITY,
): AdNotificationAddonModel {
  const ch = dto?.channels ?? {};
  const hasChannel = !!(ch.email || ch.push || ch.inApp || ch.sms || ch.whatsapp);
  const enabled = dto?.enabled === true || hasChannel;
  if (!enabled || !hasChannel) {
    return { ...EMPTY_NOTIFICATION_ADDON };
  }
  const normalized = applyChannelAvailabilityToAddon(
    {
      enabled: true,
      channels: {
        email: !!ch.email,
        push: !!ch.push,
        inApp: !!ch.inApp,
        sms: !!ch.sms,
        whatsapp: !!ch.whatsapp,
      },
    },
    available,
  );
  if (!normalized.enabled) {
    return { ...EMPTY_NOTIFICATION_ADDON };
  }
  return {
    enabled: true,
    channels: normalized.channels,
  };
}

export function notificationAddonFromDoc(
  doc: Record<string, unknown> | AdNotificationAddonModel | null | undefined,
): NotificationAddonPayload {
  const raw =
    (doc as Record<string, unknown> | null | undefined) ??
    ({} as Record<string, unknown>);
  const ch =
    (raw.channels as Record<string, unknown> | undefined) ??
    ({} as Record<string, unknown>);
  const channels = {
    email: ch.email === true,
    push: ch.push === true,
    inApp: ch.inApp === true || ch.in_app === true,
    sms: ch.sms === true,
    whatsapp: ch.whatsapp === true,
  };
  const anyChannel = Object.values(channels).some(Boolean);
  const enabled = raw.enabled === true || anyChannel;
  return {
    enabled: enabled && anyChannel,
    channels: enabled && anyChannel
      ? channels
      : {
          email: false,
          push: false,
          inApp: false,
          sms: false,
          whatsapp: false,
        },
  };
}
