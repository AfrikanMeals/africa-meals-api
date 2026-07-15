import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';

/** Sentinel : bannière globale visible dans toutes les régions actives. */
export const AD_REGION_ALL = 'ALL';

export function isAdRegionAll(raw?: string | null): boolean {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase();
  return s === AD_REGION_ALL || s === '*' || s === 'GLOBAL';
}

/** Normalise la portée régionale d’une pub : `ALL`, ISO2, ou `null`. */
export function normalizeAdRegionScope(raw?: string | null): string | null {
  if (isAdRegionAll(raw)) return AD_REGION_ALL;
  const code = normalizeCountryCode(raw);
  return code || null;
}

/**
 * Filtre public : une pub `ALL` (ou équivalent) matche toute région client.
 * Sans région client → pas de filtre. Région pub vide / invalide → exclu si client a une région.
 */
export function adRegionMatchesClient(
  clientRegion: string | undefined,
  entityRegion?: string | null,
): boolean {
  if (isAdRegionAll(entityRegion)) return true;
  const target = normalizeCountryCode(clientRegion ?? '');
  if (!target) return true;
  const source = normalizeCountryCode(entityRegion ?? '');
  if (!source) return false;
  return source === target;
}
