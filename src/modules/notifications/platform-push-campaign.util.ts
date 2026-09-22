import { UserTypeEnum } from '@schemas/user.schema';

/** Audiences admin Marketing → Campagnes push (distinct Ads Panel). */
export const PLATFORM_PUSH_CAMPAIGN_AUDIENCES = [
  'CUSTOMER',
  'VENDOR',
  'COURIER',
] as const;

export type PlatformPushCampaignAudience =
  (typeof PLATFORM_PUSH_CAMPAIGN_AUDIENCES)[number];

/** Valeur `data.audience` FCM (mobile : switch mode léger). */
export type PlatformPushCampaignFcmAudience =
  | 'customer'
  | 'vendor'
  | 'courier';

/**
 * Mappe une audience campagne → type Mongo User + tag FCM.
 * CUSTOMER → USER (enum historique client) ; COURIER → DELIVERY.
 */
export function mapPlatformPushCampaignAudience(
  audience: PlatformPushCampaignAudience,
): { userType: UserTypeEnum; fcmAudience: PlatformPushCampaignFcmAudience } {
  switch (audience) {
    case 'VENDOR':
      return { userType: UserTypeEnum.VENDOR, fcmAudience: 'vendor' };
    case 'COURIER':
      return { userType: UserTypeEnum.DELIVERY, fcmAudience: 'courier' };
    case 'CUSTOMER':
    default:
      return { userType: UserTypeEnum.USER, fcmAudience: 'customer' };
  }
}

/**
 * Déduplique + normalise les audiences (ordre stable CUSTOMER → VENDOR → COURIER).
 * Ignore les valeurs hors liste.
 */
export function normalizePlatformPushCampaignAudiences(
  raw: readonly string[],
): PlatformPushCampaignAudience[] {
  const allowed = new Set<string>(PLATFORM_PUSH_CAMPAIGN_AUDIENCES);
  const seen = new Set<PlatformPushCampaignAudience>();
  for (const item of raw) {
    const key = String(item ?? '')
      .trim()
      .toUpperCase();
    if (!allowed.has(key)) continue;
    seen.add(key as PlatformPushCampaignAudience);
  }
  return PLATFORM_PUSH_CAMPAIGN_AUDIENCES.filter((a) => seen.has(a));
}

/** Types User Mongo pour filtre `$in` (utilisateurs avec jetons FCM). */
export function userTypesForPlatformPushAudiences(
  audiences: readonly PlatformPushCampaignAudience[],
): UserTypeEnum[] {
  const types = new Set<UserTypeEnum>();
  for (const a of audiences) {
    types.add(mapPlatformPushCampaignAudience(a).userType);
  }
  return [...types];
}

/** Canal Android promotions (même id Flutter `_promotionsChannelId`). */
export const PLATFORM_PUSH_CAMPAIGN_ANDROID_CHANNEL =
  'african_meals_promotions';

/** Type FCM data — tap = ouvrir l’app (pas de deep link métier v1). */
export const PLATFORM_PUSH_CAMPAIGN_FCM_TYPE = 'platform_campaign';
