/** Motif ponctuel « autre » (libellé libre dans `reasonDetails`). */
export const PENALTY_REASON_OTHER = 'other' as const;

export const BUILTIN_PENALTY_REASON_CODES = [
  'late_delivery',
  'damaged_order',
  'missing_items',
  'poor_service',
  'no_show',
  'policy_violation',
  'compensation',
  PENALTY_REASON_OTHER,
] as const;

export type BuiltinPenaltyReasonCode =
  (typeof BUILTIN_PENALTY_REASON_CODES)[number];

const BUILTIN_LABELS_FR: Record<BuiltinPenaltyReasonCode, string> = {
  late_delivery: 'Livraison en retard',
  damaged_order: 'Commande endommagée',
  missing_items: 'Articles manquants',
  poor_service: 'Service insuffisant',
  no_show: 'Absence / non-présentation',
  policy_violation: 'Violation des règles plateforme',
  compensation: 'Compensation / geste commercial',
  other: 'Autre (motif ponctuel)',
};

export function isBuiltinPenaltyReasonCode(
  code: string,
): code is BuiltinPenaltyReasonCode {
  return (BUILTIN_PENALTY_REASON_CODES as readonly string[]).includes(code);
}

export function builtinPenaltyReasonLabel(code: string): string | null {
  if (!isBuiltinPenaltyReasonCode(code)) return null;
  return BUILTIN_LABELS_FR[code];
}

export function slugifyPenaltyMotifCode(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base ? `custom_${base}` : `custom_${Date.now()}`;
}

export function isCustomPenaltyReasonCode(code: string): boolean {
  return code.startsWith('custom_') && code.length > 7;
}
