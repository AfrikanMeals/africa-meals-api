import type { AdNotificationChannelKey } from '@modules/ads/ad-notification-billing.util';

export type AdNotificationStatsChannelRow = {
  channel: AdNotificationChannelKey;
  deliveries: number;
  interactions: number;
  conversions: number;
  interactionRatePercent: number;
  conversionRatePercent: number;
};

export type AdNotificationStatsDayBucket = {
  date: string;
  deliveries: number;
  interactions: number;
  conversions: number;
};

export type AdNotificationStatsRecentRow = {
  deliveryId: string;
  channel: AdNotificationChannelKey;
  deliveredAt: string;
  interactionAt: string | null;
  conversionAt: string | null;
};

export type AdNotificationStatsPayload = {
  addonEnabled: boolean;
  deliveriesTotal: number;
  interactionsTotal: number;
  conversionsTotal: number;
  interactionRatePercent: number;
  conversionRatePercent: number;
  channels: AdNotificationStatsChannelRow[];
  last7Days: AdNotificationStatsDayBucket[];
  recentDeliveries: AdNotificationStatsRecentRow[];
};
