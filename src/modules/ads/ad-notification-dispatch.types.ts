import type { AdNotificationItemPayload } from '@modules/ads/ad-notification-items.util';
import type { NotificationAddonPayload } from '@modules/ads/ad-notification.util';
import { AdNotificationEntityTypeEnum } from '@schemas/ad-notification-event.schema';

export type AdNotifyEntityJob = {
  kind: 'banner' | 'campaign';
  entityId: string;
};

export type AdNotifyRecipientBatchJob = {
  entityType: AdNotificationEntityTypeEnum;
  entityId: string;
  adId?: string;
  campaignId?: string;
  storeId: string;
  storeName: string;
  title: string;
  body: string;
  /** Articles campagne / bannière (préchargés à l’enqueue). */
  campaignItems?: AdNotificationItemPayload[];
  addon: NotificationAddonPayload;
  recipients: Array<{
    userId: string;
    email: string;
    phone: string;
    fullName: string;
  }>;
};
