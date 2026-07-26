/**
 * Normalise un code pays ISO2 Partner (région d’exercice).
 * Vide / invalide → null (repli prix défauts plan).
 */
export function normalizePartnerOperatingRegionCode(
  region: string | null | undefined,
): string | null {
  const code = String(region ?? '')
    .trim()
    .toUpperCase();
  // ISO 3166-1 alpha-2 uniquement (aligné candidature Partner).
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code;
}

/**
 * Région tarifaire Partner :
 * 1. Pays d’utilisation profil (`appCountryCode`) — celui affiché Settings
 * 2. Région candidature Partner (`partner_applications.region`)
 * 3. Hint client (preview admin)
 * Sinon null → prix / devise globaux du plan.
 *
 * Fix: un Partner CM au profil mais candidature CA/vide voyait encore le CAD.
 */
export function pickPartnerPricingRegionCode(args: {
  appCountryCode?: string | null;
  partnerOperatingRegion?: string | null;
  requestedRegion?: string | null;
}): string | null {
  // 1. Pays d’utilisation (source UI « Pays d'utilisation »).
  const fromAppCountry = normalizePartnerOperatingRegionCode(
    args.appCountryCode,
  );
  if (fromAppCountry) return fromAppCountry;
  // 2. Région déclarée à la candidature Partner.
  const fromPartner = normalizePartnerOperatingRegionCode(
    args.partnerOperatingRegion,
  );
  if (fromPartner) return fromPartner;
  return normalizePartnerOperatingRegionCode(args.requestedRegion);
}
