import type { AdNotificationItemPayload } from '@modules/ads/ad-notification-items.util';

export type AdTargetingProfileLean = {
  topCategories?: string[];
  interestScores?: Record<string, number>;
  conversionProbability?: number;
};

export type PickTargetedCampaignItemArgs = {
  items: AdNotificationItemPayload[];
  userId: string;
  profile?: AdTargetingProfileLean | null;
  targetingRules?: Record<string, unknown>;
  purchasedProductIds?: Set<string>;
  purchasedDrinkIds?: Set<string>;
};

export function categoryKeyFromTitle(title: string | undefined | null): string {
  const t = String(title ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return t || 'general';
}

function interestForCategory(
  profile: AdTargetingProfileLean | null | undefined,
  categoryKey: string,
  targetingRules: Record<string, unknown>,
): number {
  const scores = profile?.interestScores ?? {};
  const top = (profile?.topCategories ?? []).map((c) => c.toLowerCase());
  const key = categoryKey.toLowerCase();

  let score = Number(scores[key] ?? 0);
  if (top.includes(key)) score += 0.12;

  const minInterest = (targetingRules.min_interest_score ?? {}) as Record<
    string,
    unknown
  >;
  const required = Number(minInterest[key] ?? 0);
  if (required > 0) {
    const actual = Number(scores[key] ?? 0);
    score += Math.min(0.25, actual / required);
  }

  const categoriesRuleRaw =
    (targetingRules.target_categories as unknown[]) ??
    (targetingRules.categories as unknown[]) ??
    [];
  const categoriesRule = categoriesRuleRaw
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
  if (categoriesRule.length > 0 && categoriesRule.includes(key)) {
    score += 0.18;
  }

  return score;
}

function scoreItem(
  item: AdNotificationItemPayload,
  args: PickTargetedCampaignItemArgs,
): number {
  const categoryKey =
    item.categoryKey?.trim().toLowerCase() ||
    (item.itemType === 'DRINK' ? 'drinks' : 'general');

  let score = 0.08 + interestForCategory(args.profile, categoryKey, args.targetingRules ?? {});

  const conversionBoost = Number(args.profile?.conversionProbability ?? 0);
  score += conversionBoost * 0.08;

  const pid = item.productId?.trim() ?? '';
  const did = item.drinkId?.trim() ?? '';
  if (pid && args.purchasedProductIds?.has(pid)) {
    score += 0.55;
  }
  if (did && args.purchasedDrinkIds?.has(did)) {
    score += 0.45;
  }

  if (item.imageUrl?.trim()) score += 0.04;
  if (item.priceCad > 0) score += Math.min(0.06, item.priceCad / 200);

  return score;
}

/** Choix déterministe en cas d’égalité (même user + même campagne → même article). */
function tieBreakSalt(userId: string, item: AdNotificationItemPayload): number {
  const id = item.productId ?? item.drinkId ?? item.title;
  let h = 0;
  const s = `${userId}:${id}`;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h / 0xffffffff;
}

/**
 * Sélectionne l’article de campagne le plus pertinent pour un destinataire
 * (profil ciblage + historique commandes boutique + règles campagne).
 */
export function pickTargetedCampaignItem(
  args: PickTargetedCampaignItemArgs,
): AdNotificationItemPayload | null {
  const items = args.items.filter(
    (it) =>
      (it.productId?.trim() ?? '') !== '' ||
      (it.drinkId?.trim() ?? '') !== '' ||
      (it.title?.trim() ?? '') !== '',
  );
  if (!items.length) return null;
  if (items.length === 1) return items[0];

  let best = items[0];
  let bestScore = -1;
  for (const item of items) {
    const base = scoreItem(item, args);
    const score = base + tieBreakSalt(args.userId, item) * 0.001;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export type AdNotificationTargetLinkParams = {
  itemType?: 'PRODUCT' | 'DRINK';
  productId?: string;
  drinkId?: string;
};

export function targetItemToLinkParams(
  item: AdNotificationItemPayload | null | undefined,
): AdNotificationTargetLinkParams {
  if (!item) return {};
  if (item.itemType === 'DRINK' && item.drinkId?.trim()) {
    return {
      itemType: 'DRINK',
      drinkId: item.drinkId!.trim(),
    };
  }
  if (item.productId?.trim()) {
    return {
      itemType: 'PRODUCT',
      productId: item.productId!.trim(),
    };
  }
  return {};
}

export function appendTargetParamsToSearchParams(
  q: URLSearchParams,
  target: AdNotificationTargetLinkParams,
): void {
  if (target.itemType) q.set('itemType', target.itemType);
  if (target.productId) q.set('productId', target.productId);
  if (target.drinkId) q.set('drinkId', target.drinkId);
}
