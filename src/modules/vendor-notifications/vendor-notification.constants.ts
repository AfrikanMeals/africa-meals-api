export const VENDOR_NOTIFICATION_CATEGORIES = [
  'order',
  'delivery',
  'refund',
  'payout',
  'marketing',
  'subscription',
  'daily_menu',
  'chat',
  'account',
] as const;

export type VendorNotificationCategory =
  (typeof VENDOR_NOTIFICATION_CATEGORIES)[number];

export const VENDOR_NOTIFICATION_CHANNELS = [
  'push',
  'email',
  'sms',
] as const;

export type VendorNotificationChannel =
  (typeof VENDOR_NOTIFICATION_CHANNELS)[number];

export type VendorNotificationChannelPrefs = {
  push: boolean;
  email: boolean;
  sms: boolean;
};

export type VendorNotificationPreferencesMap = Record<
  VendorNotificationCategory,
  VendorNotificationChannelPrefs
>;

export function defaultVendorNotificationPreferences(): VendorNotificationPreferencesMap {
  const base = { push: true, email: true, sms: false };
  return {
    order: { ...base },
    delivery: { ...base },
    refund: { ...base },
    payout: { ...base },
    marketing: { ...base },
    subscription: { ...base },
    daily_menu: { ...base },
    chat: { ...base },
    account: { ...base },
  };
}

export function vendorOrderReasonToCategory(
  reason: string,
): VendorNotificationCategory {
  if (reason === 'order_shipped' || reason === 'courier_abandoned') {
    return 'delivery';
  }
  return 'order';
}

export function vendorOrderEmailEventToCategory(
  event: string,
): VendorNotificationCategory {
  if (event === 'order_shipped' || event === 'courier_abandoned') {
    return 'delivery';
  }
  return 'order';
}
