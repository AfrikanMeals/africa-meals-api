import { createHash } from 'crypto';

/** Préfixe commun Multi-Level Cache map engine (Redis L1). */
export const MAP_CACHE_PREFIX = 'map:';

export type MapCacheKind =
  | 'matrix'
  | 'route'
  | 'eta'
  | 'traffic'
  | 'distance'
  | 'address';

/** TTL défaut (secondes) — surchargeables via env `MAP_*_CACHE_TTL_SEC`. */
export const MAP_CACHE_DEFAULT_TTL_SEC: Record<MapCacheKind, number> = {
  matrix: 120,
  route: 90,
  eta: 60,
  traffic: 90,
  distance: 180,
  address: 604_800, // 7j — aligné geocode
};

export function parseMapCacheTtlSec(
  kind: MapCacheKind,
  envRaw?: string | null,
): number {
  const n = Number(envRaw);
  if (Number.isFinite(n) && n > 0) {
    return Math.min(86_400, Math.max(5, Math.trunc(n)));
  }
  return MAP_CACHE_DEFAULT_TTL_SEC[kind];
}

/** Arrondi coordonnées pour hit rate (moteur delivery ≈ 11 m @3 décimales). */
export function roundCoordForCache(value: number, decimals = 3): number {
  const p = 10 ** decimals;
  return Math.round(Number(value) * p) / p;
}

export function hashMapCacheParts(...parts: string[]): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

/** Matrice durée/distance VROOM — OSRM garde le compute, Redis cache le résultat. */
export function mapMatrixCacheKey(
  engine: string,
  coordinates: Array<[number, number]>,
): string {
  const rounded = coordinates
    .map(
      ([lng, lat]) =>
        `${roundCoordForCache(lng)},${roundCoordForCache(lat)}`,
    )
    .join(';');
  return `${MAP_CACHE_PREFIX}matrix:v1:${engine}:${hashMapCacheParts(rounded)}`;
}

/** Itinéraire OD (directions) — si proxy serveur un jour ; clé prête. */
export function mapRouteCacheKey(
  engine: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile = 'driving',
): string {
  const payload = [
    roundCoordForCache(from.lng),
    roundCoordForCache(from.lat),
    roundCoordForCache(to.lng),
    roundCoordForCache(to.lat),
    profile,
  ].join(',');
  return `${MAP_CACHE_PREFIX}route:v1:${engine}:${hashMapCacheParts(payload)}`;
}

/** Facteur / hint ETA par cellule. */
export function mapEtaCacheKey(
  lat: number,
  lng: number,
  bucketExtra = '',
): string {
  const cell = `${roundCoordForCache(lat, 3)},${roundCoordForCache(lng, 3)}`;
  return `${MAP_CACHE_PREFIX}eta:v1:${hashMapCacheParts(cell, bucketExtra)}`;
}

/** Trafic provider externe (TomTom / Mapbox). */
export function mapTrafficExtCacheKey(
  provider: string,
  lat: number,
  lng: number,
): string {
  const cell = `${roundCoordForCache(lat, 3)},${roundCoordForCache(lng, 3)}`;
  return `${MAP_CACHE_PREFIX}traffic:ext:v1:${provider}:${hashMapCacheParts(cell)}`;
}

/** Distance simple OD (si hors matrice). */
export function mapDistanceCacheKey(
  engine: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): string {
  const payload = [
    roundCoordForCache(from.lng),
    roundCoordForCache(from.lat),
    roundCoordForCache(to.lng),
    roundCoordForCache(to.lat),
  ].join(',');
  return `${MAP_CACHE_PREFIX}distance:v1:${engine}:${hashMapCacheParts(payload)}`;
}
