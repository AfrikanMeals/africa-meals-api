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
};

export const PARTNER_BADGE_DEFINITIONS: PartnerBadgeDefinition[] = [
  {
    code: PartnerBadgeCode.SILVER,
    name: 'SILVER',
    icon: '🥈',
    payoutDelayDays: 7,
  },
  {
    code: PartnerBadgeCode.GOLD,
    name: 'GOLD',
    icon: '⚜️',
    payoutDelayDays: 3,
  },
  {
    code: PartnerBadgeCode.DIAMOND,
    name: 'DIAMOND',
    icon: '💎',
    payoutDelayDays: 0,
  },
];

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
  return PARTNER_BADGE_DEFINITIONS.find((b) => b.code === code) ?? null;
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
