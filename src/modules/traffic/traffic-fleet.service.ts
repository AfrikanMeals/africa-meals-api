import { Injectable, Logger } from '@nestjs/common';
import { SharedRedisService } from '@common/redis/shared-redis.service';
import {
  trafficFactorFromSpeeds,
  trafficFleetCellKey,
} from '@common/traffic-engine-pool.util';

const FLEET_TTL_SEC = 6 * 60 * 60;
const DEFAULT_FREE_FLOW_KMH = 40;

/**
 * Agrège vitesses flotte par cellule (~500 m) dans Redis.
 */
@Injectable()
export class TrafficFleetService {
  private readonly logger = new Logger(TrafficFleetService.name);

  constructor(private readonly sharedRedis: SharedRedisService) {}

  /**
   * Ingest ping GPS livreur (vitesse m/s ou km/h).
   * Best-effort — ne bloque jamais reportLocation.
   */
  async ingestPing(args: {
    latitude: number;
    longitude: number;
    /** m/s si depuis Geolocator. */
    speedMps?: number | null;
    /** km/h si fourni explicitement. */
    speedKmh?: number | null;
    headingDegrees?: number | null;
  }): Promise<void> {
    let speedKmh = Number(args.speedKmh);
    if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
      const mps = Number(args.speedMps);
      if (Number.isFinite(mps) && mps > 0.3) {
        speedKmh = mps * 3.6;
      }
    }
    // Ignore stationnaire / bruit GPS (< 5 km/h).
    if (!Number.isFinite(speedKmh) || speedKmh < 5 || speedKmh > 160) {
      return;
    }
    if (!this.sharedRedis.isConfigured()) return;
    await this.sharedRedis.ensureConnected();
    const redis = this.sharedRedis.getClient();
    if (!redis) return;

    const key = trafficFleetCellKey(args.latitude, args.longitude);
    try {
      const prev = await redis.hgetall(key);
      const prevSum = Number(prev?.speedSum ?? 0);
      const prevCount = Number(prev?.sampleCount ?? 0);
      const nextSum = prevSum + speedKmh;
      const nextCount = prevCount + 1;
      await redis.hset(key, {
        speedSum: String(nextSum),
        sampleCount: String(nextCount),
        avgSpeedKmh: String(nextSum / nextCount),
        freeFlowKmh: String(
          Number(prev?.freeFlowKmh) > 0
            ? prev.freeFlowKmh
            : DEFAULT_FREE_FLOW_KMH,
        ),
        lastHeading: String(
          Number.isFinite(Number(args.headingDegrees))
            ? Number(args.headingDegrees)
            : '',
        ),
        updatedAt: String(Date.now()),
      });
      await redis.expire(key, FLEET_TTL_SEC);
    } catch (err) {
      this.logger.debug(
        `fleet ingest skip: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async resolveFactor(lat: number, lng: number): Promise<number | null> {
    if (!this.sharedRedis.isConfigured()) return null;
    await this.sharedRedis.ensureConnected();
    const redis = this.sharedRedis.getClient();
    if (!redis) return null;
    const key = trafficFleetCellKey(lat, lng);
    try {
      const row = await redis.hgetall(key);
      const avg = Number(row?.avgSpeedKmh);
      const samples = Number(row?.sampleCount ?? 0);
      if (!Number.isFinite(avg) || avg <= 0 || samples < 3) return null;
      const free = Number(row?.freeFlowKmh) || DEFAULT_FREE_FLOW_KMH;
      return trafficFactorFromSpeeds({
        observedSpeedKmh: avg,
        freeFlowSpeedKmh: free,
      });
    } catch {
      return null;
    }
  }
}
