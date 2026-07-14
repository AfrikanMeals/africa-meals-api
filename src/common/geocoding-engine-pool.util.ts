export const KNOWN_GEOCODING_ENGINES = [
  'osm',
  'mapsco',
  'locationiq',
  'tomtom',
  'mapbox',
  'google',
  /** Pelias (géocodeur OSM indexé dans Elasticsearch). */
  'pelias',
] as const;

export type GeocodingEngineId = (typeof KNOWN_GEOCODING_ENGINES)[number];

export type GeocodingEnginePoolEntry = {
  engine: GeocodingEngineId;
  weight: number;
};

export function normalizeGeocodingEngineId(raw: unknown): GeocodingEngineId | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'google') return 'google';
  if (v === 'mapbox') return 'mapbox';
  if (v === 'mapsco' || v === 'maps.co' || v === 'maps_co') return 'mapsco';
  if (
    v === 'locationiq' ||
    v === 'location.iq' ||
    v === 'location_iq'
  ) {
    return 'locationiq';
  }
  if (v === 'tomtom') return 'tomtom';
  if (v === 'pelias') return 'pelias';
  if (v === 'osm') return 'osm';
  return null;
}

export function normalizeGeocodingEnginePool(
  raw: unknown,
): GeocodingEnginePoolEntry[] {
  if (!Array.isArray(raw)) return [];
  const byEngine = new Map<GeocodingEngineId, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const engine = normalizeGeocodingEngineId(o.engine);
    if (!engine) continue;
    const weight = Math.max(0, Math.floor(Number(o.weight) || 0));
    if (weight <= 0) continue;
    byEngine.set(engine, (byEngine.get(engine) ?? 0) + weight);
  }
  return KNOWN_GEOCODING_ENGINES.filter((e) => (byEngine.get(e) ?? 0) > 0).map(
    (engine) => ({ engine, weight: byEngine.get(engine)! }),
  );
}

export function geocodingPoolFromScalar(
  scalar: GeocodingEngineId,
): GeocodingEnginePoolEntry[] {
  return [{ engine: scalar, weight: 100 }];
}

export function resolveGeocodingPool(
  poolRaw: unknown,
  scalar: GeocodingEngineId,
): GeocodingEnginePoolEntry[] {
  const pool = normalizeGeocodingEnginePool(poolRaw);
  if (pool.length) return pool;
  return geocodingPoolFromScalar(scalar);
}

export function primaryGeocodingEngineFromPool(
  pool: GeocodingEnginePoolEntry[],
  fallback: GeocodingEngineId,
): GeocodingEngineId {
  if (!pool.length) return fallback;
  let best = pool[0];
  for (const entry of pool) {
    if (entry.weight > best.weight) best = entry;
  }
  return best.engine;
}

export function pickWeightedGeocodingEngine(
  pool: GeocodingEnginePoolEntry[],
  isEligible: (engine: GeocodingEngineId) => boolean,
  fallback: GeocodingEngineId,
  random: () => number = Math.random,
): GeocodingEngineId {
  const eligible = pool.filter(
    (entry) => entry.weight > 0 && isEligible(entry.engine),
  );
  if (!eligible.length) {
    if (isEligible(fallback)) return fallback;
    for (const engine of KNOWN_GEOCODING_ENGINES) {
      if (isEligible(engine)) return engine;
    }
    return 'osm';
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
