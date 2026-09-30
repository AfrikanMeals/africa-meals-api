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

export const PLATFORM_PUSH_CAMPAIGN_STATUSES = [
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;

export type PlatformPushCampaignStatus =
  (typeof PLATFORM_PUSH_CAMPAIGN_STATUSES)[number];

export type PlatformPushCampaignCursor = {
  audienceIndex: number;
  lastUserId?: string;
};

/** Le worker n’envoie un lot que si la campagne est en file ou en cours. */
export function campaignJobShouldSend(
  status: string | null | undefined,
): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * Avance le curseur après un lot.
 * Lot vide ou incomplet → audience suivante. Lot plein → même audience, après le dernier id.
 */
export function advanceCampaignCursor(args: {
  audienceCount: number;
  audienceIndex: number;
  batchIds: string[];
  batchLimit: number;
}): { done: boolean; cursor: PlatformPushCampaignCursor } {
  const last =
    args.batchIds.length > 0
      ? args.batchIds[args.batchIds.length - 1]
      : undefined;
  const audienceExhausted =
    args.batchIds.length === 0 || args.batchIds.length < args.batchLimit;
  if (!audienceExhausted && last) {
    return {
      done: false,
      cursor: { audienceIndex: args.audienceIndex, lastUserId: last },
    };
  }
  const nextIndex = args.audienceIndex + 1;
  if (nextIndex >= args.audienceCount) {
    return { done: true, cursor: { audienceIndex: nextIndex } };
  }
  return { done: false, cursor: { audienceIndex: nextIndex } };
}
