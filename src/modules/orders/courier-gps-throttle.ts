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
 */
export class CourierGpsThrottle {
  private readonly lastEmitAtMs = new Map<string, number>();

  constructor(private readonly config: CourierGpsThrottleConfig) {}

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
    if (prev != null && now - prev < this.config.throttleMs) {
      return false;
    }
    this.lastEmitAtMs.set(key, now);
    return true;
  }

  coordPrecision(): number {
    return this.config.coordPrecision;
  }

  throttleMs(): number {
    return this.config.throttleMs;
  }
}
