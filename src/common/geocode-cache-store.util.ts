export const GEOCODE_CACHE_STORES = ['redis', 'memcached', 'mongodb'] as const;

export type GeocodeCacheStore = (typeof GEOCODE_CACHE_STORES)[number];

export const DEFAULT_GEOCODE_CACHE_STORE_PRIORITY: GeocodeCacheStore[] = [
  'redis',
  'memcached',
  'mongodb',
];

export function normalizeGeocodeCacheStore(raw: unknown): GeocodeCacheStore | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'redis') return 'redis';
  if (v === 'memcached' || v === 'memcache') return 'memcached';
  if (v === 'mongodb' || v === 'mongo' || v === 'db') return 'mongodb';
  return null;
}

/** Valide et complète une liste de priorité (permutation des 3 backends). */
export function normalizeGeocodeCacheStorePriority(
  raw: unknown,
): GeocodeCacheStore[] {
  const input = Array.isArray(raw) ? raw : [];
  const seen = new Set<GeocodeCacheStore>();
  const out: GeocodeCacheStore[] = [];
  for (const item of input) {
    const store = normalizeGeocodeCacheStore(item);
    if (!store || seen.has(store)) continue;
    seen.add(store);
    out.push(store);
  }
  for (const store of DEFAULT_GEOCODE_CACHE_STORE_PRIORITY) {
    if (!seen.has(store)) out.push(store);
  }
  return out;
}

export function assertGeocodeCacheStorePriority(
  raw: unknown,
): GeocodeCacheStore[] {
  const normalized = normalizeGeocodeCacheStorePriority(raw);
  if (normalized.length !== GEOCODE_CACHE_STORES.length) {
    throw new Error('geocode_cache_store_priority_incomplete');
  }
  const unique = new Set(normalized);
  if (unique.size !== GEOCODE_CACHE_STORES.length) {
    throw new Error('geocode_cache_store_priority_invalid');
  }
  return normalized;
}
