/**
 * Moteurs d’itinéraires / ETA (Directions, Routes, OSRM, Valhalla…).
 * Indépendants des moteurs d’affichage carte (tuiles) et du géocodage.
 *
 * Food delivery : **OSRM** = moteur primaire (latence / coût) ; Mapbox / Google = repli.
 * VROOM : OSRM + Valhalla en natif ; tous les autres via matrices custom injectées.
 */
export const KNOWN_ROUTING_ENGINES = [
  'osrm',
  'valhalla',
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

/** Cascade de repli — OSRM d’abord (livraison repas). */
export const ROUTING_ENGINE_FALLBACK_ORDER: RoutingEngineId[] = [
  'osrm',
  'valhalla',
  'mapbox',
  'here',
  'tomtom',
  'google_directions',
  'google_routes',
];

/**
 * Facturation livraison : Google d’abord (aligné Maps / Distance Matrix),
 * puis Mapbox / HERE / TomTom, OSRM en dernier. Pas OSRM-first (coût/latence
 * navigation) — ici on veut la distance routière la plus proche de Gmaps.
 */
export const BILLABLE_DISTANCE_ENGINE_ORDER: RoutingEngineId[] = [
  'google_directions',
  'google_routes',
  'mapbox',
  'here',
  'tomtom',
  'osrm',
  'valhalla',
];

/**
 * Pool par défaut mode livreur quand `routingEnginePool` est vide.
 * OSRM dominant ; payants en file d’attente.
 */
export const FOOD_DELIVERY_DEFAULT_ROUTING_POOL: RoutingEnginePoolEntry[] = [
  { engine: 'osrm', weight: 70 },
  { engine: 'mapbox', weight: 20 },
  { engine: 'google_routes', weight: 10 },
];

/** Routeurs que VROOM interroge nativement (sans matrice custom). */
export const VROOM_NATIVE_ROUTERS: RoutingEngineId[] = ['osrm', 'valhalla'];

/** Tous les moteurs pouvant produire une matrice durée pour VROOM. */
export const VROOM_MATRIX_CAPABLE_ENGINES: RoutingEngineId[] = [
  ...KNOWN_ROUTING_ENGINES,
];

export function isVroomNativeRouter(engine: RoutingEngineId): boolean {
  return VROOM_NATIVE_ROUTERS.includes(engine);
}

export function normalizeRoutingEngineId(raw: unknown): RoutingEngineId | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (v === 'osrm' || v === 'open_source_routing_machine') return 'osrm';
  if (v === 'valhalla') return 'valhalla';
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
  opts?: { foodDelivery?: boolean },
): RoutingEnginePoolEntry[] {
  const pool = normalizeRoutingEnginePool(poolRaw);
  if (pool.length) return pool;
  if (opts?.foodDelivery) {
    return FOOD_DELIVERY_DEFAULT_ROUTING_POOL.map((e) => ({ ...e }));
  }
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

/**
 * Sélection déterministe (poids max) — ETA stables pour le mode livreur.
 * Filtre par éligibilité ; repli cascade OSRM-first.
 */
export function pickPrimaryRoutingEngine(
  pool: RoutingEnginePoolEntry[],
  isEligible: (engine: RoutingEngineId) => boolean,
  fallback: RoutingEngineId,
): RoutingEngineId {
  const eligible = pool.filter(
    (entry) => entry.weight > 0 && isEligible(entry.engine),
  );
  if (eligible.length) {
    return primaryRoutingEngineFromPool(eligible, fallback);
  }
  if (isEligible(fallback)) return fallback;
  for (const engine of ROUTING_ENGINE_FALLBACK_ORDER) {
    if (isEligible(engine)) return engine;
  }
  return 'osrm';
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
    for (const engine of ROUTING_ENGINE_FALLBACK_ORDER) {
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

/**
 * Ordre d’essai facturation : Google d’abord, sans doubler Routes/Directions
 * (même Distance Matrix). Filtre `isEligible` (clés / URL présentes).
 */
export function billableDistanceEngineTryOrder(
  isEligible: (engine: RoutingEngineId) => boolean,
): RoutingEngineId[] {
  const out: RoutingEngineId[] = [];
  let googleTried = false;
  for (const engine of BILLABLE_DISTANCE_ENGINE_ORDER) {
    const isGoogle =
      engine === 'google_directions' || engine === 'google_routes';
    if (isGoogle) {
      if (googleTried) continue;
      if (!isEligible('google_directions') && !isEligible('google_routes')) {
        continue;
      }
      googleTried = true;
      // Distance Matrix est câblée sur les deux ids — on n’en tente qu’un.
      out.push(
        isEligible('google_directions') ? 'google_directions' : 'google_routes',
      );
      continue;
    }
    if (isEligible(engine)) out.push(engine);
  }
  return out;
}

/** Ordre d’essai : préféré puis cascade OSRM-first. */
export function routingEngineTryOrder(
  preferred: RoutingEngineId,
): RoutingEngineId[] {
  const out: RoutingEngineId[] = [preferred];
  for (const engine of ROUTING_ENGINE_FALLBACK_ORDER) {
    if (!out.includes(engine)) out.push(engine);
  }
  return out;
}

/**
 * Ordre d’essai depuis le pool Admin (Map Settings).
 * 1) preferred (ou plus gros poids)
 * 2) reste du pool par poids décroissant
 * 3) cascade soft (OSRM…) pour résilience si tous les moteurs du pool échouent
 */
export function routingEngineTryOrderFromPool(
  pool: RoutingEnginePoolEntry[],
  preferred?: RoutingEngineId | null,
): RoutingEngineId[] {
  const byWeight = [...pool]
    .filter((e) => e.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((e) => e.engine);
  const out: RoutingEngineId[] = [];
  const pref =
    preferred ??
    (byWeight.length
      ? primaryRoutingEngineFromPool(
          pool.filter((e) => e.weight > 0),
          byWeight[0]!,
        )
      : null);
  if (pref) out.push(pref);
  for (const engine of byWeight) {
    if (!out.includes(engine)) out.push(engine);
  }
  for (const engine of ROUTING_ENGINE_FALLBACK_ORDER) {
    if (!out.includes(engine)) out.push(engine);
  }
  return out.length ? out : (['osrm'] as RoutingEngineId[]);
}

export function routingEngineLabel(engine: RoutingEngineId): string {
  switch (engine) {
    case 'osrm':
      return 'OSRM (OpenStreetMap)';
    case 'valhalla':
      return 'Valhalla';
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
