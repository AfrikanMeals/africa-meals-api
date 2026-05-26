import type { LoyaltyTierName } from './loyalty.constants';
import type { ResolvedLoyaltyTier } from './loyalty-settings.util';

export function loyaltyTierFromPoints(
  points: number,
  tiers: ResolvedLoyaltyTier[],
): LoyaltyTierName {
  const p = Math.max(0, Math.floor(points));
  let tier: LoyaltyTierName = 'Bronze';
  for (const t of tiers) {
    if (p >= t.min) tier = t.name;
  }
  return tier;
}

export function loyaltyProgressPercent(
  points: number,
  tiers: ResolvedLoyaltyTier[],
): number {
  const p = Math.max(0, Math.floor(points));
  const tier = loyaltyTierFromPoints(p, tiers);
  const idx = tiers.findIndex((t) => t.name === tier);
  const current = tiers[idx];
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

export function loyaltyNextTierProgress(
  points: number,
  tiers: ResolvedLoyaltyTier[],
): { nextTier: string | null; pointsToNextTier: number } {
  const p = Math.max(0, Math.floor(points));
  const current = loyaltyTierFromPoints(p, tiers);
  const idx = tiers.findIndex((t) => t.name === current);
  if (idx < 0 || idx >= tiers.length - 1) {
    return { nextTier: null, pointsToNextTier: 0 };
  }
  const next = tiers[idx + 1];
  return {
    nextTier: next.name,
    pointsToNextTier: Math.max(0, next.min - p),
  };
}

export function isMemberActive(lastOrderAt: Date | null, inactiveDays: number): boolean {
  if (!lastOrderAt) return false;
  const ms = inactiveDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastOrderAt.getTime() <= ms;
}
