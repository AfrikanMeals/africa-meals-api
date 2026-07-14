/** Index GEO live livreurs (Redis core GEOADD — pas besoin de Redis Stack). */
export const COURIER_GEO_LIVE_KEY = 'geo:couriers:live';

/** Meta par livreur : `geo:courier:{agentUserId}` (TTL = fraîcheur GPS). */
export const COURIER_GEO_META_PREFIX = 'geo:courier:';

/** TTL meta (s) — au-delà, le livreur est considéré stale et filtré / ZREM. */
export const COURIER_GEO_META_TTL_SEC = 120;

/** Rayon défaut recherches dispatcher (km). */
export const COURIER_GEO_DEFAULT_RADIUS_KM = 15;

export function courierGeoMetaKey(agentUserId: string): string {
  return `${COURIER_GEO_META_PREFIX}${agentUserId.trim()}`;
}
