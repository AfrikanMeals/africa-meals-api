/**
 * Moteur trafic plateforme (OSM n’a pas de trafic natif).
 * - fleet : télémétrie livreurs (GPS + vitesse + cap)
 * - tomtom : TomTom Traffic Flow API
 * - mapbox : Mapbox Directions `driving-traffic`
 * - none : pas de correction (factor 1 / env)
 */

export const KNOWN_TRAFFIC_ENGINES = ['fleet', 'tomtom', 'mapbox'] as const;

export type TrafficEngineId = (typeof KNOWN_TRAFFIC_ENGINES)[number];

/** Valeur stockée / admin : moteur primaire, peut être `none`. */
export type TrafficEnginePrimary = TrafficEngineId | 'none';

export type TrafficEnginePoolEntry = {
  engine: TrafficEngineId;
  weight: number;
};

export function normalizeTrafficEngineId(raw: unknown): TrafficEngineId | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'fleet' || v === 'own' || v === 'self') return 'fleet';
  if (v === 'tomtom') return 'tomtom';
  if (v === 'mapbox') return 'mapbox';
  return null;
}

export function normalizeTrafficEnginePrimary(
  raw: unknown,
): TrafficEnginePrimary {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'none' || v === 'off' || v === 'disabled' || v === '') {
    return 'none';
  }
  return normalizeTrafficEngineId(v) ?? 'none';
}

export function normalizeTrafficEnginePool(
  raw: unknown,
): TrafficEnginePoolEntry[] {
  if (!Array.isArray(raw)) return [];
  const byEngine = new Map<TrafficEngineId, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const engine = normalizeTrafficEngineId(o.engine);
    if (!engine) continue;
    const weight = Math.max(0, Math.floor(Number(o.weight) || 0));
    if (weight <= 0) continue;
    byEngine.set(engine, (byEngine.get(engine) ?? 0) + weight);
  }
  return KNOWN_TRAFFIC_ENGINES.filter((e) => (byEngine.get(e) ?? 0) > 0).map(
    (engine) => ({ engine, weight: byEngine.get(engine)! }),
  );
}

export function trafficPoolFromScalar(
  scalar: TrafficEnginePrimary,
): TrafficEnginePoolEntry[] {
  if (scalar === 'none') return [];
  return [{ engine: scalar, weight: 100 }];
}

export function resolveTrafficPool(
  poolRaw: unknown,
  scalar: TrafficEnginePrimary,
): TrafficEnginePoolEntry[] {
  const pool = normalizeTrafficEnginePool(poolRaw);
  if (pool.length) return pool;
  return trafficPoolFromScalar(scalar);
}

export function primaryTrafficEngineFromPool(
  pool: TrafficEnginePoolEntry[],
  fallback: TrafficEnginePrimary = 'none',
): TrafficEnginePrimary {
  if (!pool.length) return fallback;
  let best = pool[0]!;
  for (const entry of pool) {
    if (entry.weight > best.weight) best = entry;
  }
  return best.engine;
}

export function pickWeightedTrafficEngine(
  pool: TrafficEnginePoolEntry[],
  isEligible: (engine: TrafficEngineId) => boolean,
  fallback: TrafficEnginePrimary = 'none',
  random: () => number = Math.random,
): TrafficEnginePrimary {
  const eligible = pool.filter(
    (entry) => entry.weight > 0 && isEligible(entry.engine),
  );
  if (!eligible.length) {
    if (fallback !== 'none' && isEligible(fallback)) return fallback;
    for (const engine of KNOWN_TRAFFIC_ENGINES) {
      if (isEligible(engine)) return engine;
    }
    return 'none';
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

/** Convertit vitesses libre/observée en facteur ETA (≥1 = plus lent). */
export function trafficFactorFromSpeeds(opts: {
  observedSpeedKmh: number;
  freeFlowSpeedKmh: number;
}): number {
  const obs = Number(opts.observedSpeedKmh);
  const free = Number(opts.freeFlowSpeedKmh);
  if (!Number.isFinite(obs) || obs <= 0.5) return 1.5;
  if (!Number.isFinite(free) || free <= 0) return 1;
  const factor = free / obs;
  return Math.min(2.5, Math.max(0.7, factor));
}

/** Cellule ~500 m pour agrégat flotte. */
export function trafficFleetCellKey(lat: number, lng: number): string {
  const cellLat = Math.round(lat * 200) / 200;
  const cellLng = Math.round(lng * 200) / 200;
  return `traffic:fleet:${cellLat.toFixed(3)},${cellLng.toFixed(3)}`;
}
