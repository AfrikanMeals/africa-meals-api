/**
 * Moteurs d’itinéraires / ETA (Directions, Routes, OSRM…).
 * Indépendants des moteurs d’affichage carte (tuiles) et du géocodage.
 */
export const KNOWN_ROUTING_ENGINES = [
  'osrm',
  'mapbox',
  'google_routes',
  'google_directions',
  'here',
  'tomtom',
] as const;

export type RoutingEngineId = (typeof KNOWN_ROUTING_ENGINES)[number];

export type RoutingEnginePoolEntry = {
  engine: RoutingEngineId;
  weight: number;
};

export function normalizeRoutingEngineId(raw: unknown): RoutingEngineId | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'osrm' || v === 'open_source_routing_machine') return 'osrm';
  if (v === 'mapbox' || v === 'mapbox_directions') return 'mapbox';
  if (
    v === 'google_routes' ||
    v === 'google_route' ||
    v === 'routes_api' ||
    v === 'google_routes_api'
  ) {
    return 'google_routes';
  }
  if (
    v === 'google_directions' ||
    v === 'google' ||
    v === 'directions' ||
    v === 'google_directions_api'
  ) {
    return 'google_directions';
  }
  if (v === 'here' || v === 'here_routing') return 'here';
  if (v === 'tomtom' || v === 'tomtom_routing') return 'tomtom';
  return null;
}

export function normalizeRoutingEnginePool(
  raw: unknown,
): RoutingEnginePoolEntry[] {
  if (!Array.isArray(raw)) return [];
  const byEngine = new Map<RoutingEngineId, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const engine = normalizeRoutingEngineId(o.engine);
    if (!engine) continue;
    const weight = Math.max(0, Math.floor(Number(o.weight) || 0));
    if (weight <= 0) continue;
    byEngine.set(engine, (byEngine.get(engine) ?? 0) + weight);
  }
  return KNOWN_ROUTING_ENGINES.filter((e) => (byEngine.get(e) ?? 0) > 0).map(
    (engine) => ({ engine, weight: byEngine.get(engine)! }),
  );
}

export function routingPoolFromScalar(
  scalar: RoutingEngineId,
): RoutingEnginePoolEntry[] {
  return [{ engine: scalar, weight: 100 }];
}

export function resolveRoutingPool(
  poolRaw: unknown,
  scalar: RoutingEngineId,
): RoutingEnginePoolEntry[] {
  const pool = normalizeRoutingEnginePool(poolRaw);
  if (pool.length) return pool;
  return routingPoolFromScalar(scalar);
}

export function primaryRoutingEngineFromPool(
  pool: RoutingEnginePoolEntry[],
  fallback: RoutingEngineId,
): RoutingEngineId {
  if (!pool.length) return fallback;
  let best = pool[0]!;
  for (const entry of pool) {
    if (entry.weight > best.weight) best = entry;
  }
  return best.engine;
}

export function pickWeightedRoutingEngine(
  pool: RoutingEnginePoolEntry[],
  isEligible: (engine: RoutingEngineId) => boolean,
  fallback: RoutingEngineId,
  random: () => number = Math.random,
): RoutingEngineId {
  const eligible = pool.filter(
    (entry) => entry.weight > 0 && isEligible(entry.engine),
  );
  if (!eligible.length) {
    if (isEligible(fallback)) return fallback;
    for (const engine of KNOWN_ROUTING_ENGINES) {
      if (isEligible(engine)) return engine;
    }
    return 'osrm';
  }
  if (eligible.length === 1) return eligible[0]!.engine;
  const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return eligible[0]!.engine;
  let roll = random() * total;
  for (const entry of eligible) {
    roll -= entry.weight;
    if (roll <= 0) return entry.engine;
  }
  return eligible[eligible.length - 1]!.engine;
}

export function routingEngineLabel(engine: RoutingEngineId): string {
  switch (engine) {
    case 'osrm':
      return 'OSRM (OpenStreetMap)';
    case 'mapbox':
      return 'Mapbox Directions';
    case 'google_routes':
      return 'Google Routes API';
    case 'google_directions':
      return 'Google Directions';
    case 'here':
      return 'HERE Routing';
    case 'tomtom':
      return 'TomTom Routing';
    default:
      return engine;
  }
}
