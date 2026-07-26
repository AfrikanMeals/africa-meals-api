import { randomBytes } from 'crypto';

/** Alphabet alphanumérique complet (A–Z, 0–9) — saisie admin libre sur 6 chars. */
export const PARTNER_REFERRAL_CODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const PARTNER_REFERRAL_CODE_LENGTH = 6;

/**
 * Génère un code referral partenaire (longueur fixe, majuscules).
 * La collision DB est gérée par le caller (retry + index unique).
 */
export function generatePartnerReferralCode(
  length: number = PARTNER_REFERRAL_CODE_LENGTH,
): string {
  const alphabet = PARTNER_REFERRAL_CODE_ALPHABET;
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

/** Accepte uniquement un code exactement 6 chars A–Z / 0–9. */
export function isValidPartnerReferralCode(raw: string | null | undefined): boolean {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (code.length !== PARTNER_REFERRAL_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!PARTNER_REFERRAL_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/** Normalise pour stockage / comparaison (trim + uppercase). */
export function normalizePartnerReferralCode(
  raw: string | null | undefined,
): string | null {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return isValidPartnerReferralCode(code) ? code : null;
}
