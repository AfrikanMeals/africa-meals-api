import { normalizeCountryCode } from '@common/normalize-geocode-query.util';

/**
 * Pays effectif pour un forward geocode.
 * `worldwide: true` → pas de repli user/CA (fiche partenaire multi-région).
 * Sinon : args → appCountryCode user → CA.
 */
export function resolveGeocodeForwardCountryCode(input: {
  countryCode?: string | null
  userAppCountryCode?: string | null
  worldwide?: boolean
}): string {
  const fromArgs = normalizeCountryCode(input.countryCode)
  // Recherche mondiale : n’imposer aucun pays (même si le compte est CA).
  if (input.worldwide) return fromArgs
  return (
    fromArgs ||
    normalizeCountryCode(input.userAppCountryCode) ||
    'CA'
  )
}
