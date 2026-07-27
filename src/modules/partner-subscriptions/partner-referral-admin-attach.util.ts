/**
 * Types pouvant être filleuls d’un Partner (axes Customer / Vendor / Courier).
 * PARTNER / ADMIN ne s’auto-attachent jamais.
 */
export const PARTNER_REFERRAL_ATTACHABLE_USER_TYPES = [
  'USER',
  'VENDOR',
  'DELIVERY',
] as const;

export type PartnerReferralAttachableUserType =
  (typeof PARTNER_REFERRAL_ATTACHABLE_USER_TYPES)[number];

export type PartnerReferralAxisKey = 'customer' | 'vendor' | 'courier';

export type AdminPartnerReferralAttachDenyReason =
  | 'partner_referral_not_for_partner'
  | 'partner_referral_self'
  | 'partner_referral_already_set';

/**
 * Client / vendeur / livreur uniquement — aligné onglets Référents.
 */
export function isPartnerReferralAttachableUserType(
  type: string | null | undefined,
): type is PartnerReferralAttachableUserType {
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  return (PARTNER_REFERRAL_ATTACHABLE_USER_TYPES as readonly string[]).includes(
    t,
  );
}

/** Mapping type user → axe Référents (UI / reporting). */
export function partnerReferralAxisForUserType(
  type: string | null | undefined,
): PartnerReferralAxisKey | null {
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  if (t === 'USER') return 'customer';
  if (t === 'VENDOR') return 'vendor';
  if (t === 'DELIVERY') return 'courier';
  return null;
}

/**
 * Décide si un attach (self-service ou admin) est autorisé.
 * `force` = true uniquement côté admin (écrase un référent déjà posé).
 */
export function evaluatePartnerReferralAttach(args: {
  targetType: string | null | undefined;
  targetUserId: string;
  partnerUserId: string;
  existingPartnerUserId?: string | null;
  force?: boolean;
}):
  | { ok: true; willOverride: boolean }
  | { ok: false; reason: AdminPartnerReferralAttachDenyReason } {
  if (!isPartnerReferralAttachableUserType(args.targetType)) {
    return { ok: false, reason: 'partner_referral_not_for_partner' };
  }
  const targetId = String(args.targetUserId ?? '').trim();
  const partnerId = String(args.partnerUserId ?? '').trim();
  if (!targetId || !partnerId || targetId === partnerId) {
    return { ok: false, reason: 'partner_referral_self' };
  }
  const existing = String(args.existingPartnerUserId ?? '').trim();
  if (existing) {
    // Self-service : une seule fois ; admin avec force peut corriger.
    if (!args.force) {
      return { ok: false, reason: 'partner_referral_already_set' };
    }
    return { ok: true, willOverride: true };
  }
  return { ok: true, willOverride: false };
}
