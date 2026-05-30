import { BadRequestException } from '@nestjs/common';
import { LOYALTY_REWARD_CATALOG } from './loyalty.constants';

export type LoyaltyRewardItem = {
  id: string;
  title: string;
  icon: string;
  points: number;
  category: string;
  active: boolean;
};

const CATALOG_IDS = new Set<string>(
  LOYALTY_REWARD_CATALOG.map((r) => String(r.id)),
);

function readRewardActive(
  patch: Partial<LoyaltyRewardItem> | undefined,
  defaultActive: boolean,
): boolean {
  if (!patch || !('active' in patch)) {
    return defaultActive;
  }
  const v = patch.active;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 1 || v === '1') return true;
  if (v === 'false' || v === 0 || v === '0') return false;
  return defaultActive;
}

/** Fusionne les récompenses stockées avec le catalogue par défaut (ids fixes). */
export function mergeRewardsCatalog(
  stored?: Array<Partial<LoyaltyRewardItem>> | null,
): LoyaltyRewardItem[] {
  const byId = new Map<string, Partial<LoyaltyRewardItem>>();
  for (const row of stored ?? []) {
    if (row?.id && CATALOG_IDS.has(String(row.id))) {
      byId.set(String(row.id), row);
    }
  }
  return LOYALTY_REWARD_CATALOG.map((def) => {
    const patch = byId.get(def.id);
    const title = String(patch?.title ?? def.title).trim();
    const icon = String(patch?.icon ?? def.icon).trim();
    const points = Math.max(0, Math.floor(Number(patch?.points ?? def.points)));
    const category =
      String(patch?.category ?? def.category).trim() || def.category;
    return {
      id: def.id,
      title: title || def.title,
      icon: icon || def.icon,
      points: Number.isFinite(points) ? points : def.points,
      category,
      active: readRewardActive(patch, def.active),
    };
  });
}

/** Valide une mise à jour admin (tous les ids du catalogue requis). */
export function normalizeRewardsUpdate(
  input: Array<Partial<LoyaltyRewardItem>>,
): LoyaltyRewardItem[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestException('invalid_loyalty_rewards');
  }
  const seen = new Set<string>();
  for (const row of input) {
    const id = String(row?.id ?? '').trim();
    if (!CATALOG_IDS.has(id) || seen.has(id)) {
      throw new BadRequestException('invalid_loyalty_reward_id');
    }
    seen.add(id);
  }
  if (seen.size !== CATALOG_IDS.size) {
    throw new BadRequestException('loyalty_rewards_incomplete');
  }
  const title = (r: Partial<LoyaltyRewardItem>) => String(r.title ?? '').trim();
  for (const row of input) {
    if (!title(row)) {
      throw new BadRequestException('invalid_loyalty_reward_title');
    }
    const pts = Math.floor(Number(row.points ?? 0));
    if (!Number.isFinite(pts) || pts < 0 || pts > 100_000) {
      throw new BadRequestException('invalid_loyalty_reward_points');
    }
  }
  return mergeRewardsCatalog(input);
}
