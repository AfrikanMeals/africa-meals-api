import { Injectable, Logger } from '@nestjs/common';
import { SharedRedisService } from '@common/redis/shared-redis.service';
import { haversineMeters } from '@modules/delivery-order-offer/delivery-order-offer.ranking';
import {
  COURIER_GEO_DEFAULT_RADIUS_KM,
  COURIER_GEO_LIVE_KEY,
  COURIER_GEO_META_TTL_SEC,
  courierGeoMetaKey,
} from './courier-geo.constants';
import { isValidWgs84, parseGeoSearchWithDist } from './courier-geo.util';

export type CourierGeoHit = {
  agentUserId: string;
  /** Distance en mètres depuis le point de requête. */
  distanceMeters: number;
  latitude?: number;
  longitude?: number;
};

/**
 * Positions live livreurs via Redis GEO (cache `REDIS_*`).
 * Fallback silencieux si Redis indisponible — Mongo reste source durable.
 */
@Injectable()
export class CourierGeoService {
  private readonly logger = new Logger(CourierGeoService.name);

  constructor(private readonly sharedRedis: SharedRedisService) {}

  isEnabled(): boolean {
    return this.sharedRedis.isConfigured();
  }

  /**
   * Upsert position live. Best-effort — ne doit jamais casser `reportLocation`.
   */
  async upsertCourierPosition(args: {
    agentUserId: string;
    latitude: number;
    longitude: number;
    regionCode?: string | null;
    availability?: string | null;
  }): Promise<boolean> {
    const agentUserId = String(args.agentUserId ?? '').trim();
    if (!agentUserId || !isValidWgs84(args.latitude, args.longitude)) {
      return false;
    }
    if (String(args.availability ?? '').trim() === 'hors_ligne') {
      await this.removeCourier(agentUserId);
      return true;
    }

    await this.sharedRedis.ensureConnected();
    const redis = this.sharedRedis.getClient();
    if (!redis) return false;

    try {
      await redis.geoadd(
        COURIER_GEO_LIVE_KEY,
        args.longitude,
        args.latitude,
        agentUserId,
      );
      const metaKey = courierGeoMetaKey(agentUserId);
      await redis.hset(metaKey, {
        lat: String(args.latitude),
        lng: String(args.longitude),
        updatedAt: String(Date.now()),
        region: String(args.regionCode ?? '').trim(),
        availability:
          String(args.availability ?? 'disponible').trim() || 'disponible',
      });
      await redis.expire(metaKey, COURIER_GEO_META_TTL_SEC);
      return true;
    } catch (err) {
      this.logger.warn(
        `GEOADD failed agent=${agentUserId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  async removeCourier(agentUserId: string): Promise<void> {
    const uid = String(agentUserId ?? '').trim();
    if (!uid) return;
    await this.sharedRedis.ensureConnected();
    const redis = this.sharedRedis.getClient();
    if (!redis) return;
    try {
      await redis.zrem(COURIER_GEO_LIVE_KEY, uid);
      await redis.del(courierGeoMetaKey(uid));
    } catch (err) {
      this.logger.warn(
        `GEO ZREM failed agent=${uid}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Livreurs dans un rayon (km), triés par distance croissante.
   * Filtre les membres sans meta fraîche (TTL expiré).
   */
  async searchNearby(args: {
    latitude: number;
    longitude: number;
    radiusKm?: number;
    limit?: number;
  }): Promise<CourierGeoHit[]> {
    if (!isValidWgs84(args.latitude, args.longitude)) return [];
    await this.sharedRedis.ensureConnected();
    const redis = this.sharedRedis.getClient();
    if (!redis) return [];

    const radiusKm = Math.max(
      0.1,
      Math.min(200, Number(args.radiusKm) || COURIER_GEO_DEFAULT_RADIUS_KM),
    );
    const limit = Math.max(1, Math.min(200, Math.trunc(args.limit ?? 40)));

    try {
      const raw = await redis.geosearch(
        COURIER_GEO_LIVE_KEY,
        'FROMLONLAT',
        args.longitude,
        args.latitude,
        'BYRADIUS',
        radiusKm,
        'km',
        'ASC',
        'COUNT',
        limit,
        'WITHDIST',
      );
      const parsed = parseGeoSearchWithDist(raw);
      if (parsed.length === 0) return [];

      const pipeline = redis.pipeline();
      for (const row of parsed) {
        pipeline.exists(courierGeoMetaKey(row.member));
      }
      const existsRes = await pipeline.exec();
      const hits: CourierGeoHit[] = [];
      const stale: string[] = [];

      parsed.forEach((row, i) => {
        const exists = existsRes?.[i]?.[1] === 1;
        if (!exists) {
          stale.push(row.member);
          return;
        }
        hits.push({
          agentUserId: row.member,
          distanceMeters: Math.round(row.distanceKm * 1000),
        });
      });

      if (stale.length > 0) {
        void redis.zrem(COURIER_GEO_LIVE_KEY, ...stale).catch(() => undefined);
      }
      return hits;
    } catch (err) {
      this.logger.warn(
        `GEOSEARCH failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * Distances (m) pour un ensemble de livreurs — GEOPOS + haversine.
   * IDs absents de l’index GEO sont omis (repli Mongo côté caller).
   */
  async distancesFromPointMeters(
    longitude: number,
    latitude: number,
    agentUserIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = [
      ...new Set(
        agentUserIds.map((id) => String(id ?? '').trim()).filter(Boolean),
      ),
    ];
    if (!ids.length || !isValidWgs84(latitude, longitude)) return out;

    await this.sharedRedis.ensureConnected();
    const redis = this.sharedRedis.getClient();
    if (!redis) return out;

    try {
      const pipeline = redis.pipeline();
      for (const id of ids) {
        pipeline.geopos(COURIER_GEO_LIVE_KEY, id);
      }
      const res = await pipeline.exec();
      ids.forEach((id, i) => {
        const pos = res?.[i]?.[1] as
          | [string, string]
          | [string, string][]
          | null
          | undefined;
        let lngRaw: unknown;
        let latRaw: unknown;
        if (Array.isArray(pos) && Array.isArray(pos[0])) {
          lngRaw = pos[0][0];
          latRaw = pos[0][1];
        } else if (Array.isArray(pos) && pos.length >= 2) {
          lngRaw = pos[0];
          latRaw = pos[1];
        } else {
          return;
        }
        if (lngRaw == null || latRaw == null) return;
        const lng = Number(lngRaw);
        const lat = Number(latRaw);
        if (!isValidWgs84(lat, lng)) return;
        out.set(
          id,
          Math.round(haversineMeters([longitude, latitude], [lng, lat])),
        );
      });
    } catch (err) {
      this.logger.warn(
        `GEOPOS batch failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return out;
  }
}
