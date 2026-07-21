export type RoutingCacheSettings = {
  /** TTL itinéraire statique (boutique→client), secondes. */
  staticTtlSeconds: number
  /** TTL itinéraire dynamique (GPS→cible), secondes. */
  dynamicTtlSeconds: number
  /** Re-calcul Directions si l’origine GPS a bougé de plus de N mètres. */
  agentMoveInvalidateMeters: number
  /** Demander des routes alternatives (coût Mapbox plus élevé). */
  requestAlternatives: boolean
  /** TTL cache admin (suivi live), millisecondes. */
  adminTtlMs: number
  /** Filtre GPS marqueur (précision navigation), mètres. */
  gpsMarkerDistanceFilterMeters: number
  /** Debounce refresh itinéraire après tick GPS, ms. */
  routeRefreshDebounceMs: number
}

export const DEFAULT_ROUTING_CACHE_SETTINGS: RoutingCacheSettings = {
  staticTtlSeconds: 900,
  dynamicTtlSeconds: 45,
  agentMoveInvalidateMeters: 100,
  requestAlternatives: false,
  adminTtlMs: 120_000,
  gpsMarkerDistanceFilterMeters: 5,
  // Aligné mobile : recalcul hors-route plus réactif (fail-open thrash via sticky).
  routeRefreshDebounceMs: 700,
}

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function normalizeRoutingCacheSettings(
  raw?: unknown,
): RoutingCacheSettings {
  const o =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    staticTtlSeconds: clampInt(
      o.staticTtlSeconds,
      60,
      3_600,
      DEFAULT_ROUTING_CACHE_SETTINGS.staticTtlSeconds,
    ),
    dynamicTtlSeconds: clampInt(
      o.dynamicTtlSeconds,
      10,
      300,
      DEFAULT_ROUTING_CACHE_SETTINGS.dynamicTtlSeconds,
    ),
    agentMoveInvalidateMeters: clampInt(
      o.agentMoveInvalidateMeters,
      25,
      500,
      DEFAULT_ROUTING_CACHE_SETTINGS.agentMoveInvalidateMeters,
    ),
    requestAlternatives: o.requestAlternatives === true,
    adminTtlMs: clampInt(
      o.adminTtlMs,
      30_000,
      600_000,
      DEFAULT_ROUTING_CACHE_SETTINGS.adminTtlMs,
    ),
    gpsMarkerDistanceFilterMeters: clampInt(
      o.gpsMarkerDistanceFilterMeters,
      1,
      25,
      DEFAULT_ROUTING_CACHE_SETTINGS.gpsMarkerDistanceFilterMeters,
    ),
    routeRefreshDebounceMs: clampInt(
      o.routeRefreshDebounceMs,
      300,
      5_000,
      DEFAULT_ROUTING_CACHE_SETTINGS.routeRefreshDebounceMs,
    ),
  }
}
