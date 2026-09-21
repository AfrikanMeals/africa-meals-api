/** Ping HTTP livreur → Redis GEO + WS (frère de `routingCache`, raisons de changer distinctes). */

export const COURIER_GPS_REALTIME_PROFILES = [
  'performant',
  'optimal',
  'precise',
  'custom',
] as const;

export type CourierGpsRealtimeProfile =
  (typeof COURIER_GPS_REALTIME_PROFILES)[number];

export type CourierGpsPingSettings = {
  /** OFF = plus de POST location (pin local appareil inchangé). */
  enabled: boolean
  /** Course active — précision (ms). */
  intervalActiveMs: number
  /** Pas de course — économie batterie (ms). */
  intervalIdleMs: number
  /** Preset admin ; `custom` si l’opérateur a retouché les champs. */
  profile: CourierGpsRealtimeProfile
  /** Buffer GPS local + POST d’une trail (streaming coords). */
  streamCoordinates: boolean
  /** Cadence d’échantillonnage locale pendant le stream (ms). */
  streamSampleMs: number
  /** Max points trail par POST. */
  streamMaxPoints: number
  /** 0 = pas de filtre ; sinon drop des samples trop imprécis. */
  maxAccuracyMeters: number
  /** Piggyback présence + statut commande sur le flux GPS (WS). */
  syncStatusAndState: boolean
}

/** Patch cache itinéraires couplé au preset carte livreur (marqueur + debounce). */
export type CourierMapRealtimeRoutingPatch = {
  gpsMarkerDistanceFilterMeters: number
  routeRefreshDebounceMs: number
}

export type CourierGpsTrailPoint = {
  latitude: number
  longitude: number
  recordedAt?: string
  headingDegrees?: number | null
  speedMps?: number | null
  accuracyMeters?: number | null
}

export type CourierGpsRealtimeExtras = {
  trail?: CourierGpsTrailPoint[]
  presence?: string
  availability?: string
  activeOrderCount?: number
}

/** Fail-open : absents → comportement historique (ping ON, 2 s / 20 s, pas de stream). */
export const DEFAULT_COURIER_GPS_PING_SETTINGS: CourierGpsPingSettings = {
  enabled: true,
  intervalActiveMs: 2_000,
  intervalIdleMs: 20_000,
  profile: 'custom',
  streamCoordinates: false,
  streamSampleMs: 1_000,
  streamMaxPoints: 4,
  maxAccuracyMeters: 0,
  syncStatusAndState: false,
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

function parseProfile(raw: unknown): CourierGpsRealtimeProfile {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (v === 'performant' || v === 'optimal' || v === 'precise' || v === 'custom') {
    return v
  }
  return 'custom'
}

/**
 * Normalise le bloc admin `courierGpsPing`.
 * `enabled` / stream / sync désactivés seulement si explicitement `false` (sauf stream/sync : opt-in).
 */
export function normalizeCourierGpsPingSettings(
  raw?: unknown,
): CourierGpsPingSettings {
  const o =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_COURIER_GPS_PING_SETTINGS
  return {
    enabled: o.enabled !== false,
    intervalActiveMs: clampInt(o.intervalActiveMs, 1_000, 10_000, d.intervalActiveMs),
    intervalIdleMs: clampInt(o.intervalIdleMs, 5_000, 60_000, d.intervalIdleMs),
    profile: parseProfile(o.profile),
    // Opt-in : absent → pas de stream (ne pas changer le ping historique).
    streamCoordinates: o.streamCoordinates === true,
    streamSampleMs: clampInt(o.streamSampleMs, 250, 2_000, d.streamSampleMs),
    streamMaxPoints: clampInt(o.streamMaxPoints, 2, 12, d.streamMaxPoints),
    maxAccuracyMeters: clampInt(o.maxAccuracyMeters, 0, 100, d.maxAccuracyMeters),
    syncStatusAndState: o.syncStatusAndState === true,
  }
}

/** Défense API : apps non à jour ou admin OFF → skip Mongo/GEO/WS. */
export function shouldSkipCourierGpsHttpReport(
  ping: CourierGpsPingSettings,
): boolean {
  return ping.enabled === false
}

/**
 * Skip GEO/WS si le sample est trop imprécis (filtre admin).
 * Absent / NaN → fail-open (apps sans `accuracyMeters`).
 */
export function shouldSkipCourierGpsForAccuracy(
  ping: CourierGpsPingSettings,
  accuracyMeters?: number | null,
): boolean {
  if (ping.maxAccuracyMeters <= 0) return false
  if (accuracyMeters == null || !Number.isFinite(accuracyMeters)) return false
  return accuracyMeters > ping.maxAccuracyMeters
}

/**
 * Throttle WS flotte / order:tracking : suit l’intervalle actif admin
 * pour ne pas jeter un ping 2 s derrière un throttle env 3 s figé.
 * Plancher 1000 ms ; si ping OFF, conserve le défaut env.
 */
export function resolveCourierGpsWsThrottleMs(
  ping: CourierGpsPingSettings,
  envThrottleMs: number,
): number {
  const envFloor = Math.max(1_000, Math.floor(envThrottleMs) || 3_000)
  if (!ping.enabled) return envFloor
  return Math.max(1_000, ping.intervalActiveMs)
}

const PRESET_VALUES: Record<
  Exclude<CourierGpsRealtimeProfile, 'custom'>,
  {
    ping: CourierGpsPingSettings
    routing: CourierMapRealtimeRoutingPatch
  }
> = {
  // Batterie / coût : moins d’HTTP, trail courte, filtre GPS large.
  performant: {
    ping: {
      enabled: true,
      intervalActiveMs: 4_000,
      intervalIdleMs: 30_000,
      profile: 'performant',
      streamCoordinates: true,
      streamSampleMs: 1_500,
      streamMaxPoints: 4,
      maxAccuracyMeters: 40,
      syncStatusAndState: true,
    },
    routing: {
      gpsMarkerDistanceFilterMeters: 8,
      routeRefreshDebounceMs: 1_800,
    },
  },
  // Équilibre recommandé : 2 s + stream + sync statut.
  optimal: {
    ping: {
      enabled: true,
      intervalActiveMs: 2_000,
      intervalIdleMs: 20_000,
      profile: 'optimal',
      streamCoordinates: true,
      streamSampleMs: 500,
      streamMaxPoints: 5,
      maxAccuracyMeters: 25,
      syncStatusAndState: true,
    },
    routing: {
      gpsMarkerDistanceFilterMeters: 5,
      routeRefreshDebounceMs: 1_200,
    },
  },
  // Fidélité max : 1 s, trail dense, filtre GPS serré.
  precise: {
    ping: {
      enabled: true,
      intervalActiveMs: 1_000,
      intervalIdleMs: 10_000,
      profile: 'precise',
      streamCoordinates: true,
      streamSampleMs: 250,
      streamMaxPoints: 8,
      maxAccuracyMeters: 15,
      syncStatusAndState: true,
    },
    routing: {
      gpsMarkerDistanceFilterMeters: 2,
      routeRefreshDebounceMs: 400,
    },
  },
}

/** Preset admin Paramètres → Carte → Ping GPS (boutons Optimal / Performant / Précis). */
export function courierMapRealtimePreset(
  profile: Exclude<CourierGpsRealtimeProfile, 'custom'>,
): { ping: CourierGpsPingSettings; routing: CourierMapRealtimeRoutingPatch } {
  return {
    ping: { ...PRESET_VALUES[profile].ping },
    routing: { ...PRESET_VALUES[profile].routing },
  }
}

function pingMatchesPreset(
  ping: CourierGpsPingSettings,
  expected: CourierGpsPingSettings,
): boolean {
  return (
    ping.enabled === expected.enabled &&
    ping.intervalActiveMs === expected.intervalActiveMs &&
    ping.intervalIdleMs === expected.intervalIdleMs &&
    ping.streamCoordinates === expected.streamCoordinates &&
    ping.streamSampleMs === expected.streamSampleMs &&
    ping.streamMaxPoints === expected.streamMaxPoints &&
    ping.maxAccuracyMeters === expected.maxAccuracyMeters &&
    ping.syncStatusAndState === expected.syncStatusAndState
  )
}

/**
 * Détecte le bouton à surligner. Si le cache itinéraires est fourni, il doit coller aussi.
 */
export function matchCourierMapRealtimePreset(
  ping: CourierGpsPingSettings,
  routing?: CourierMapRealtimeRoutingPatch | null,
): CourierGpsRealtimeProfile {
  const keys: Array<Exclude<CourierGpsRealtimeProfile, 'custom'>> = [
    'performant',
    'optimal',
    'precise',
  ]
  for (const key of keys) {
    const preset = PRESET_VALUES[key]
    if (!pingMatchesPreset(ping, preset.ping)) continue
    if (routing) {
      if (
        routing.gpsMarkerDistanceFilterMeters !==
          preset.routing.gpsMarkerDistanceFilterMeters ||
        routing.routeRefreshDebounceMs !== preset.routing.routeRefreshDebounceMs
      ) {
        continue
      }
    }
    return key
  }
  return 'custom'
}

/** Sanitise la trail GPS (max 12, coords valides). */
export function normalizeCourierGpsTrail(
  raw: unknown,
  maxPoints: number,
): CourierGpsTrailPoint[] {
  if (!Array.isArray(raw)) return []
  const cap = Math.min(12, Math.max(1, Math.floor(maxPoints) || 4))
  const out: CourierGpsTrailPoint[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const latitude = Number(o.latitude)
    const longitude = Number(o.longitude)
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      continue
    }
    const recordedAt =
      typeof o.recordedAt === 'string' && o.recordedAt.trim()
        ? o.recordedAt.trim()
        : undefined
    const heading = Number(o.headingDegrees)
    const speed = Number(o.speedMps)
    const accuracy = Number(o.accuracyMeters)
    out.push({
      latitude,
      longitude,
      ...(recordedAt ? { recordedAt } : {}),
      headingDegrees:
        Number.isFinite(heading) && heading >= 0 && heading <= 360
          ? heading
          : null,
      speedMps:
        Number.isFinite(speed) && speed >= 0 && speed <= 80 ? speed : null,
      accuracyMeters:
        Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 500
          ? accuracy
          : null,
    })
    if (out.length >= cap) break
  }
  return out
}

/** Compact WS : lat/lng/at seulement (payload flotte / tracking). */
export function courierTrailWsFields(
  trail: CourierGpsTrailPoint[] | undefined,
): Array<{ latitude: number; longitude: number; recordedAt?: string }> {
  if (!trail?.length) return []
  return trail.map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
    ...(p.recordedAt ? { recordedAt: p.recordedAt } : {}),
  }))
}
