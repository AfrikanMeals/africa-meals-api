import { PartnerAccountType } from '@schemas/partner-profile.schema';

/** Champs minimaux pour valider / soumettre une fiche partenaire. */
export type PartnerProfileFields = {
  accountType?: PartnerAccountType | string | null;
  individualName?: string | null;
  companyName?: string | null;
  taxNumber?: string | null;
  address?: string | null;
  addressLatitude?: number | null;
  addressLongitude?: number | null;
  facebookUrl?: string | null;
  tiktokUrl?: string | null;
  instagramUrl?: string | null;
  policyAccepted?: boolean | null;
};

/** Normalise le type de compte (ignore casse / espaces). */
export function normalizePartnerAccountType(
  raw: string | null | undefined,
): PartnerAccountType | null {
  const t = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (t === PartnerAccountType.INDIVIDUAL) {
    return PartnerAccountType.INDIVIDUAL;
  }
  if (t === PartnerAccountType.COMPANY) {
    return PartnerAccountType.COMPANY;
  }
  return null;
}

/** Nom affiché selon le type (individu vs société). */
export function resolvePartnerDisplayName(
  fields: PartnerProfileFields,
): string | null {
  const type = normalizePartnerAccountType(
    fields.accountType as string | undefined,
  );
  if (type === PartnerAccountType.INDIVIDUAL) {
    const n = String(fields.individualName ?? '').trim();
    return n.length >= 2 ? n : null;
  }
  if (type === PartnerAccountType.COMPANY) {
    const n = String(fields.companyName ?? '').trim();
    return n.length >= 2 ? n : null;
  }
  return null;
}

/** Lien social optionnel : vide OK ; sinon préfixe http(s). */
export function isOptionalHttpUrl(raw: string | null | undefined): boolean {
  const v = String(raw ?? '').trim();
  if (!v) return true;
  return /^https?:\/\/.+/i.test(v);
}

/**
 * Étape 1 (identité) complète : type + nom adapté + adresse.
 * GPS carte optionnel côté API (requis UX mobile avant Continuer).
 * Tax number volontairement hors garde-fou (optionnel).
 */
export function isPartnerProfileIdentityComplete(
  fields: PartnerProfileFields,
): boolean {
  if (!normalizePartnerAccountType(fields.accountType as string | undefined)) {
    return false;
  }
  if (!resolvePartnerDisplayName(fields)) return false;
  return String(fields.address ?? '').trim().length >= 5;
}

/** Étape 3 : politique cochée + identité OK (réseaux optionnels mais valides). */
export function isPartnerProfileReadyToSubmit(
  fields: PartnerProfileFields,
): boolean {
  if (!isPartnerProfileIdentityComplete(fields)) return false;
  if (!fields.policyAccepted) return false;
  return (
    isOptionalHttpUrl(fields.facebookUrl) &&
    isOptionalHttpUrl(fields.tiktokUrl) &&
    isOptionalHttpUrl(fields.instagramUrl)
  );
}
