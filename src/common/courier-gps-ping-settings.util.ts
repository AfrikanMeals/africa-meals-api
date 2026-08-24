/** Ping HTTP livreur → Redis GEO + WS (frère de `routingCache`, raisons de changer distinctes). */
export type CourierGpsPingSettings = {
  /** OFF = plus de POST location (pin local appareil inchangé). */
  enabled: boolean
  /** Course active — précision (ms). */
  intervalActiveMs: number
  /** Pas de course — économie batterie (ms). */
  intervalIdleMs: number
}

/** Fail-open : absents → comportement historique (ping ON, 2 s / 20 s). */
export const DEFAULT_COURIER_GPS_PING_SETTINGS: CourierGpsPingSettings = {
  enabled: true,
  intervalActiveMs: 2_000,
  intervalIdleMs: 20_000,
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

/**
 * Normalise le bloc admin `courierGpsPing`.
 * `enabled` désactivé seulement si explicitement `false`.
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
  }
}

/** Défense API : apps non à jour ou admin OFF → skip Mongo/GEO/WS. */
export function shouldSkipCourierGpsHttpReport(
  ping: CourierGpsPingSettings,
): boolean {
  return ping.enabled === false
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
