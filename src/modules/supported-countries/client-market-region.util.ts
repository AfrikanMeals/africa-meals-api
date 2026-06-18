/** Code pays ISO2 normalisé (vide si invalide). */
export function normalizeCountryCode(raw?: string | null): string {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

/** Filtre direct sur la collection `stores`. */
export function storeDirectRegionMatch(
  clientRegion: string,
): Record<string, unknown> {
  const code = normalizeCountryCode(clientRegion);
  if (!code) return {};
  return { region: code };
}

/** Filtre après `$lookup` store sur produit / boisson. */
export function embeddedStoreRegionMatch(
  clientRegion: string,
): Record<string, unknown> {
  const code = normalizeCountryCode(clientRegion);
  if (!code) return {};
  return { 'store.region': code };
}
