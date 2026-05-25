import {
  LOYALTY_TIER_THRESHOLDS,
  type LoyaltyTierName,
} from './loyalty.constants';

export function loyaltyTierFromPoints(points: number): LoyaltyTierName {
  const p = Math.max(0, Math.floor(points));
  let tier: LoyaltyTierName = 'Bronze';
  for (const t of LOYALTY_TIER_THRESHOLDS) {
    if (p >= t.min) tier = t.name;
  }
  return tier;
}

export function loyaltyProgressPercent(points: number): number {
  const p = Math.max(0, Math.floor(points));
  const tier = loyaltyTierFromPoints(p);
  const idx = LOYALTY_TIER_THRESHOLDS.findIndex((t) => t.name === tier);
  const current = LOYALTY_TIER_THRESHOLDS[idx];
  if (!current || current.max == null) return 100;
  const span = current.max - current.min;
  if (span <= 0) return 100;
  return Math.min(100, Math.round(((p - current.min) / span) * 100));
}

export function pointsUsedFromRewardHistory(
  history: Array<{ points?: number }> | undefined,
): number {
  if (!Array.isArray(history)) return 0;
  return history.reduce((sum, row) => {
    const pts = Number(row?.points ?? 0);
    return pts < 0 ? sum + Math.abs(pts) : sum;
  }, 0);
}

export function isMemberActive(lastOrderAt: Date | null, inactiveDays: number): boolean {
  if (!lastOrderAt) return false;
  const ms = inactiveDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastOrderAt.getTime() <= ms;
}
