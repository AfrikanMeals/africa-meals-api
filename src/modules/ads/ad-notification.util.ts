import { NotificationAddonDto } from '@modules/ads/dto/ad-notification.dto';
import { AdNotificationAddonModel } from '@schemas/ad-notification-addon.schema';

export type NotificationAddonPayload = {
  enabled: boolean;
  channels: {
    email: boolean;
    push: boolean;
    inApp: boolean;
    sms: boolean;
  };
};

export const EMPTY_NOTIFICATION_ADDON: NotificationAddonPayload = {
  enabled: false,
  channels: { email: false, push: false, inApp: false, sms: false },
};

export function normalizeNotificationAddonInput(
  dto?: NotificationAddonDto | null,
): AdNotificationAddonModel {
  if (!dto?.enabled) {
    return { ...EMPTY_NOTIFICATION_ADDON };
  }
  const ch = dto.channels ?? {};
  const hasChannel = !!(ch.email || ch.push || ch.inApp || ch.sms);
  if (!hasChannel) {
    return { ...EMPTY_NOTIFICATION_ADDON };
  }
  return {
    enabled: true,
    channels: {
      email: !!ch.email,
      push: !!ch.push,
      inApp: !!ch.inApp,
      sms: !!ch.sms,
    },
  };
}

export function notificationAddonFromDoc(
  doc: Record<string, unknown> | AdNotificationAddonModel | null | undefined,
): NotificationAddonPayload {
  const raw =
    (doc as Record<string, unknown> | null | undefined) ??
    ({} as Record<string, unknown>);
  const enabled = raw.enabled === true;
  const ch =
    (raw.channels as Record<string, unknown> | undefined) ??
    ({} as Record<string, unknown>);
  return {
    enabled,
    channels: {
      email: enabled && ch.email === true,
      push: enabled && ch.push === true,
      inApp: enabled && (ch.inApp === true || ch.in_app === true),
      sms: enabled && ch.sms === true,
    },
  };
}
