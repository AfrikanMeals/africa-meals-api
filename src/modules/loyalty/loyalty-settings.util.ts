import { BadRequestException } from '@nestjs/common';
import {
  LOYALTY_CURRENCY,
  LOYALTY_TIER_THRESHOLDS,
  type LoyaltyTierName,
} from './loyalty.constants';

export type ResolvedLoyaltyTier = {
  name: LoyaltyTierName;
  min: number;
  max: number | null;
  icon: string;
  color: string;
  bg: string;
  advantages: string[];
};

export type ResolvedLoyaltyConfig = {
  currency: string;
  inactiveDays: number;
  cadPerPoint: number;
  welcomeBonusPoints: number;
  tiers: ResolvedLoyaltyTier[];
};

/** Lit `cadPerPoint` ou l’ancien champ `fcfaPerPoint` en base. */
export function readCadPerPointFromDoc(doc: Record<string, unknown>): number {
  const raw =
    doc.cadPerPoint ??
    doc.cad_per_point ??
    doc.fcfaPerPoint ??
    doc.fcfa_per_point;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 100;
}

const TIER_NAMES: LoyaltyTierName[] = [
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
];

const DEFAULT_BY_NAME = new Map(
  LOYALTY_TIER_THRESHOLDS.map((t) => [t.name, t]),
);

export function defaultLoyaltyConfig(): ResolvedLoyaltyConfig {
  return {
    currency: LOYALTY_CURRENCY,
    inactiveDays: 30,
    cadPerPoint: 100,
    welcomeBonusPoints: 50,
    tiers: LOYALTY_TIER_THRESHOLDS.map((t) => ({
      name: t.name,
      min: t.min,
      max: t.max,
      icon: t.icon,
      color: t.color,
      bg: t.bg,
      advantages: [...t.advantages],
    })),
  };
}

export function mergeTierMetadata(
  input: Array<{ name: string; min: number; max?: number | null }>,
): ResolvedLoyaltyTier[] {
  const byName = new Map(input.map((t) => [t.name, t]));
  const merged = TIER_NAMES.map((name) => {
    const row = byName.get(name);
    const def = DEFAULT_BY_NAME.get(name);
    if (!row || !def) {
      throw new BadRequestException('invalid_loyalty_tiers');
    }
    return {
      name,
      min: Math.floor(row.min),
      max: row.max == null ? null : Math.floor(row.max),
      icon: def.icon,
      color: def.color,
      bg: def.bg,
      advantages: [...def.advantages],
    };
  });
  for (let i = 0; i < merged.length - 1; i++) {
    merged[i].max = merged[i + 1].min;
  }
  merged[merged.length - 1].max = null;
  return merged;
}

export function validateTierChain(tiers: ResolvedLoyaltyTier[]): void {
  if (tiers.length !== TIER_NAMES.length) {
    throw new BadRequestException('invalid_loyalty_tiers');
  }
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.name !== TIER_NAMES[i]) {
      throw new BadRequestException('invalid_loyalty_tier_order');
    }
    if (t.min < 0) throw new BadRequestException('invalid_loyalty_tier_min');
    if (i === 0 && t.min !== 0) {
      throw new BadRequestException('bronze_min_must_be_zero');
    }
    if (i > 0 && t.min <= tiers[i - 1].min) {
      throw new BadRequestException('loyalty_tier_mins_must_increase');
    }
    const expectedMax =
      i < tiers.length - 1 ? tiers[i + 1].min : null;
    if (i < tiers.length - 1) {
      if (t.max == null || t.max !== expectedMax) {
        throw new BadRequestException('loyalty_tier_max_must_match_next_min');
      }
    } else if (t.max != null) {
      throw new BadRequestException('platinum_max_must_be_unlimited');
    }
  }
}

export function configFromDocument(doc: Record<string, unknown>): ResolvedLoyaltyConfig {
  const base = defaultLoyaltyConfig();
  const tiersRaw = Array.isArray(doc.tiers) && (doc.tiers as unknown[]).length
    ? (doc.tiers as Array<{
        name: string;
        min: number;
        max?: number | null;
      }>)
    : base.tiers;
  const tiers = mergeTierMetadata(
    tiersRaw.map((t) => ({
      name: t.name,
      min: Number(t.min ?? 0),
      max: t.max == null ? null : Number(t.max),
    })),
  );
  try {
    validateTierChain(tiers);
  } catch {
    return base;
  }
  const currencyRaw = String(doc.currency ?? doc.currency_code ?? '').trim();
  const currency =
    currencyRaw.length >= 3 ? currencyRaw.toUpperCase() : LOYALTY_CURRENCY;
  return {
    currency,
    inactiveDays: Math.max(
      1,
      Math.floor(Number(doc.inactiveDays ?? base.inactiveDays)),
    ),
    cadPerPoint: readCadPerPointFromDoc(doc),
    welcomeBonusPoints: Math.max(
      0,
      Math.floor(Number(doc.welcomeBonusPoints ?? base.welcomeBonusPoints)),
    ),
    tiers,
  };
}

function formatCadAmount(amount: number): string {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: LOYALTY_CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function accumulationRulesFromConfig(
  config: ResolvedLoyaltyConfig,
): Array<{ key: string; value: string }> {
  return [
    {
      key: '1 point équivaut à',
      value: `${formatCadAmount(config.cadPerPoint)} dépensés`,
    },
    {
      key: 'Bonus activation programme',
      value: `${config.welcomeBonusPoints} points`,
    },
    {
      key: 'Crédit automatique',
      value: 'À chaque commande livrée (statut completed)',
    },
    {
      key: 'Éligibilité',
      value: 'Activation manuelle par un administrateur',
    },
  ];
}
