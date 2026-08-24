import { parsePositiveInt } from '../../common/bullmq-redis-connection';

export type CourierGpsThrottleConfig = {
  throttleMs: number;
  coordPrecision: number;
};

export function readCourierGpsThrottleConfig(
  env: NodeJS.ProcessEnv = process.env,
): CourierGpsThrottleConfig {
  return {
    throttleMs: parsePositiveInt(env.COURIER_GPS_THROTTLE_MS, 3000),
    coordPrecision: parsePositiveInt(env.COURIER_GPS_COORD_PRECISION, 4),
  };
}

export function roundCourierCoordinate(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, Math.min(8, precision));
  return Math.round(value * factor) / factor;
}

/**
 * Max 1 publication GPS / (agent, commande) par fenêtre throttleMs (OPT-002).
 * `setThrottleMs` aligne la fenêtre sur Paramètres → Carte (`courierGpsPing`).
 */
export class CourierGpsThrottle {
  private readonly lastEmitAtMs = new Map<string, number>();
  private throttleMsValue: number;

  constructor(private readonly config: CourierGpsThrottleConfig) {
    this.throttleMsValue = config.throttleMs;
  }

  /** Met à jour le throttle runtime (plancher 1000 ms). */
  setThrottleMs(ms: number): void {
    const n = Math.floor(Number(ms));
    this.throttleMsValue = Number.isFinite(n) ? Math.max(1_000, n) : 1_000;
  }

  shouldPublish(
    agentUserId: string,
    orderId: string,
    latitude: number,
    longitude: number,
  ): boolean {
    const agentId = agentUserId.trim();
    const oid = orderId.trim();
    if (!agentId || !oid) return false;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return false;
    }

    const key = `${agentId}:${oid}`;
    const now = Date.now();
    const prev = this.lastEmitAtMs.get(key);
    if (prev != null && now - prev < this.throttleMsValue) {
      return false;
    }
    this.lastEmitAtMs.set(key, now);
    return true;
  }

  coordPrecision(): number {
    return this.config.coordPrecision;
  }

  throttleMs(): number {
    return this.throttleMsValue;
  }
}
