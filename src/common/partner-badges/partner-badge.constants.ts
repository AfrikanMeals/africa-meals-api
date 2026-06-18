import { getPartnerBadgeDefinitionsCache } from './partner-badge.cache';

export enum PartnerBadgeCode {
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  DIAMOND = 'DIAMOND',
}

/** Badge appliqué lorsqu’aucun badge explicite n’est enregistré. */
export const DEFAULT_PARTNER_BADGE_CODE = PartnerBadgeCode.SILVER;

export type PartnerBadgeDefinition = {
  code: PartnerBadgeCode;
  name: string;
  icon: string;
  /** Délai Stripe avant versement (0 = instantané via `method=instant`). */
  payoutDelayDays: number;
  sortOrder?: number;
};

/** Valeurs par défaut (seed) si la base est vide. */
export const PARTNER_BADGE_DEFINITIONS: PartnerBadgeDefinition[] = [
  {
    code: PartnerBadgeCode.SILVER,
    name: 'SILVER',
    icon: '🥈',
    payoutDelayDays: 7,
    sortOrder: 1,
  },
  {
    code: PartnerBadgeCode.GOLD,
    name: 'GOLD',
    icon: '⚜️',
    payoutDelayDays: 3,
    sortOrder: 2,
  },
  {
    code: PartnerBadgeCode.DIAMOND,
    name: 'DIAMOND',
    icon: '💎',
    payoutDelayDays: 0,
    sortOrder: 3,
  },
];

function activePartnerBadgeDefinitions(): PartnerBadgeDefinition[] {
  const cached = getPartnerBadgeDefinitionsCache();
  return cached.length > 0 ? cached : PARTNER_BADGE_DEFINITIONS;
}

export type PartnerBadgeSnapshot = {
  code: PartnerBadgeCode;
  name: string;
  icon: string;
  payoutDelayDays: number;
};

export type PartnerBadgePayoutMethod = 'instant' | 'standard';

export function isPartnerBadgeCode(
  raw: string | null | undefined,
): raw is PartnerBadgeCode {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return (
    code === PartnerBadgeCode.SILVER ||
    code === PartnerBadgeCode.GOLD ||
    code === PartnerBadgeCode.DIAMOND
  );
}

/** Code effectif pour versements Stripe (défaut SILVER). */
export function resolveEffectivePartnerBadgeCode(
  raw: string | null | undefined,
): PartnerBadgeCode {
  return isPartnerBadgeCode(raw) ? raw : DEFAULT_PARTNER_BADGE_CODE;
}

export function getPartnerBadgeDefinition(
  raw: string | null | undefined,
): PartnerBadgeDefinition | null {
  const code = resolveEffectivePartnerBadgeCode(raw);
  return activePartnerBadgeDefinitions().find((b) => b.code === code) ?? null;
}

/** Liste catalogue (admin / assignation). */
export function listPartnerBadgeDefinitions(): PartnerBadgeDefinition[] {
  return activePartnerBadgeDefinitions();
}

export function serializePartnerBadge(
  raw: string | null | undefined,
): PartnerBadgeSnapshot {
  const def = getPartnerBadgeDefinition(raw)!;
  return {
    code: def.code,
    name: def.name,
    icon: def.icon,
    payoutDelayDays: def.payoutDelayDays,
  };
}

export function partnerBadgePayoutMethod(
  raw: string | null | undefined,
): PartnerBadgePayoutMethod {
  const def = getPartnerBadgeDefinition(raw);
  return def?.payoutDelayDays === 0 ? 'instant' : 'standard';
}

export function partnerBadgePayoutTimingLabelFr(
  raw: string | null | undefined,
): string {
  const def = getPartnerBadgeDefinition(raw);
  if (!def) return '1 semaine';
  if (def.payoutDelayDays <= 0) return 'Instantané (≈30 min)';
  if (def.payoutDelayDays === 1) return '1 jour ouvré';
  if (def.payoutDelayDays === 7) return '1 semaine';
  return `${def.payoutDelayDays} jours ouvrés`;
}

/** Libellé affiché quand le badge prévoit l’instantané mais Stripe ne le supporte pas. */
export function partnerBadgeStandardFallbackTimingLabelFr(): string {
  return 'Standard (2–3 jours ouvrés)';
}

export function resolvePartnerBadgePayoutPresentation(params: {
  badgeCode: string | null | undefined;
  instantPayoutAvailable: boolean;
}): {
  payoutMethod: PartnerBadgePayoutMethod;
  payoutTimingLabel: string;
  instantPayoutAvailable?: boolean;
} {
  const badgeMethod = partnerBadgePayoutMethod(params.badgeCode);
  const badgeTiming = partnerBadgePayoutTimingLabelFr(params.badgeCode);

  if (badgeMethod !== 'instant') {
    return {
      payoutMethod: badgeMethod,
      payoutTimingLabel: badgeTiming,
    };
  }

  if (!params.instantPayoutAvailable) {
    return {
      payoutMethod: 'standard',
      payoutTimingLabel: partnerBadgeStandardFallbackTimingLabelFr(),
      instantPayoutAvailable: false,
    };
  }

  return {
    payoutMethod: 'instant',
    payoutTimingLabel: badgeTiming,
    instantPayoutAvailable: true,
  };
}

export type PartnerBadgeChangeDirection = 'upgrade' | 'downgrade' | 'unchanged';

/** Compare les délais de versement (Diamond > Gold > Silver). */
export function partnerBadgeChangeDirection(
  previousCode: string | null | undefined,
  nextCode: string | null | undefined,
): PartnerBadgeChangeDirection {
  const previous = resolveEffectivePartnerBadgeCode(previousCode);
  const next = resolveEffectivePartnerBadgeCode(nextCode);
  if (previous === next) return 'unchanged';
  const prevDays = getPartnerBadgeDefinition(previous)!.payoutDelayDays;
  const nextDays = getPartnerBadgeDefinition(next)!.payoutDelayDays;
  if (nextDays < prevDays) return 'upgrade';
  if (nextDays > prevDays) return 'downgrade';
  return 'unchanged';
}
