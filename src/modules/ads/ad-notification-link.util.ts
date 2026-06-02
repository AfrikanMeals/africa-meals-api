import {
  appendTargetParamsToSearchParams,
  type AdNotificationTargetLinkParams,
} from '@modules/ads/ad-notification-item-targeting.util';
import { AdNotificationEntityTypeEnum } from '@schemas/ad-notification-event.schema';

export type AdNotificationLinkParams = {
  deliveryId: string;
  entityType: AdNotificationEntityTypeEnum;
  entityId: string;
  storeId: string;
  webBaseUrl: string;
  appScheme?: string;
} & AdNotificationTargetLinkParams;

function applyTargetQuery(
  q: URLSearchParams,
  params: AdNotificationTargetLinkParams,
): void {
  appendTargetParamsToSearchParams(q, params);
}

/** Lien HTTPS (e-mail / SMS) — ouvre l’app via page web ou App Links. */
export function buildAdNotificationWebOpenUrl(
  params: AdNotificationLinkParams,
): string {
  const base = params.webBaseUrl.replace(/\/+$/, '');
  const q = new URLSearchParams({
    deliveryId: params.deliveryId,
    entity: params.entityType === AdNotificationEntityTypeEnum.CAMPAIGN
      ? 'campaign'
      : 'banner',
    id: params.entityId,
    storeId: params.storeId,
  });
  applyTargetQuery(q, params);
  return `${base}/ads/open?${q.toString()}`;
}

/** Deep link direct (push / in-app). */
export function buildAdNotificationAppDeepLink(
  params: AdNotificationLinkParams,
): string {
  const scheme = (params.appScheme ?? 'wise-eat').replace(/:\/\//, '');
  const q = new URLSearchParams({
    deliveryId: params.deliveryId,
    entity: params.entityType === AdNotificationEntityTypeEnum.CAMPAIGN
      ? 'campaign'
      : 'banner',
    id: params.entityId,
    storeId: params.storeId,
  });
  applyTargetQuery(q, params);
  return `${scheme}://open/ad?${q.toString()}`;
}
