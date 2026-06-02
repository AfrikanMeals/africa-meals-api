/**
 * Utilitaires placement / position pour le scoring des recommandations ads.
 *
 * Convention `targetingRules` (campagnes) :
 * - `placements`: string[] — ex. `home_feed`, `home_feed:slot_0`, `catalog_feed`, `campaign_slider`
 * - `priority`: number 0–100 — plus bas = priorité éditoriale plus forte
 * - `preferred_slot`: number — index de slot optimal (0 = premier)
 */

export type CampaignPlacementStats = {
  impressions: number;
  clicks: number;
  purchases: number;
};

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function normalizePlacementKey(placement: string): string {
  return String(placement ?? '')
    .trim()
    .toLowerCase();
}

/** Clés de placement à matcher en base (exact + parent sans suffixe slot). */
export function expandPlacementKeys(placement: string): string[] {
  const key = normalizePlacementKey(placement);
  if (!key) return [];
  const out = new Set<string>([key]);
  const slotIdx = key.indexOf(':slot_');
  if (slotIdx > 0) {
    out.add(key.slice(0, slotIdx));
  }
  return [...out];
}

export function parseSlotIndex(
  placement: string,
  explicitSlot?: number | null,
): number | null {
  if (
    explicitSlot != null &&
    Number.isFinite(explicitSlot) &&
    explicitSlot >= 0
  ) {
    return Math.floor(explicitSlot);
  }
  const key = normalizePlacementKey(placement);
  const m = key.match(/:slot_(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function buildPlacementWithSlot(
  basePlacement: string,
  slot: number,
): string {
  const base = normalizePlacementKey(basePlacement) || 'home_feed';
  const idx = Math.max(0, Math.floor(slot));
  if (base.includes(':slot_')) return base;
  return `${base}:slot_${idx}`;
}

export function matchesPlacementRules(
  rules: Record<string, unknown>,
  placement: string,
): boolean {
  const allowed = Array.isArray(rules.placements)
    ? rules.placements.map((x) => normalizePlacementKey(String(x)))
    : [];
  if (!allowed.length) return true;
  const keys = expandPlacementKeys(placement);
  return keys.some((k) => allowed.includes(k));
}

export function readEditorialPriority(rules: Record<string, unknown>): number {
  const raw = rules.priority;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function readPreferredSlot(rules: Record<string, unknown>): number {
  const raw = rules.preferred_slot ?? rules.preferredSlot;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    const priority = readEditorialPriority(rules);
    if (priority <= 15) return 0;
    if (priority <= 35) return 1;
    return 2;
  }
  return Math.min(10, Math.floor(n));
}

/** Fit éditorial + adéquation au slot demandé (0–1). */
export function computePositionBoost(input: {
  priority: number;
  preferredSlot: number;
  requestSlot: number | null;
}): number {
  const editorial = clamp01((100 - input.priority) / 100);
  if (input.requestSlot == null) {
    return clamp01(editorial * 0.75 + 0.2);
  }
  const dist = Math.abs(input.requestSlot - input.preferredSlot);
  const slotFit = clamp01(1 - dist / 4);
  return clamp01(editorial * 0.5 + slotFit * 0.5);
}

/** Affinité action campagne × profil (conversion & parcours livraison). */
export function computeDeliveryConversionBoost(input: {
  actionType: string;
  hasProductItems: boolean;
  segment: string;
  conversionProbability: number;
  requestSlot: number | null;
}): number {
  const action = String(input.actionType ?? 'SHOP')
    .trim()
    .toUpperCase();
  let boost = 0.35;

  if (action === 'PRODUCT') boost += 0.35;
  else if (action === 'SHOP') boost += 0.28;
  else if (action === 'WEBSITE') boost += 0.12;

  if (input.hasProductItems) boost += 0.12;

  const seg = String(input.segment ?? '').toLowerCase();
  if (seg === 'high_intent_buyer') boost += 0.2;
  else if (seg === 'loyal_user') boost += 0.1;

  boost += clamp01(input.conversionProbability) * 0.15;

  if (input.requestSlot === 0) {
    if (action === 'PRODUCT' || action === 'SHOP') boost += 0.12;
  } else if (input.requestSlot != null && input.requestSlot >= 2) {
    boost += 0.05;
  }

  return clamp01(boost);
}

/** Performance historique sur le placement (CTR + conversions légères). */
export function computePlacementPerformanceBoost(
  stats: CampaignPlacementStats | undefined,
): number {
  if (!stats) return 0.4;
  const imp = stats.impressions;
  const clk = stats.clicks;
  const pur = stats.purchases;
  if (imp <= 0 && clk <= 0 && pur <= 0) return 0.45;
  const ctr = clk / Math.max(1, imp);
  const convRate = pur / Math.max(1, clk + imp);
  return clamp01(ctr * 2.2 + convRate * 4 + (clk > 0 ? 0.1 : 0));
}

export function placementMatchScore(
  rules: Record<string, unknown>,
  placement: string,
): number {
  const allowed = Array.isArray(rules.placements)
    ? rules.placements.map((x) => normalizePlacementKey(String(x)))
    : [];
  if (!allowed.length) return 1;
  const keys = expandPlacementKeys(placement);
  if (keys.some((k) => allowed.includes(k))) return 1;
  const base = keys[0]?.split(':slot_')[0] ?? '';
  if (base && allowed.includes(base)) return 0.65;
  return 0;
}
