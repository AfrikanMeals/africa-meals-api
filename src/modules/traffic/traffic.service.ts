import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MapSettingsService } from '@modules/map-settings/map-settings.service';
import {
  normalizeTrafficEnginePrimary,
  pickWeightedTrafficEngine,
  resolveTrafficPool,
  type TrafficEngineId,
  type TrafficEnginePrimary,
} from '@common/traffic-engine-pool.util';
import { GraphMapIntelligenceService } from '@modules/graph/graph-map-intelligence.service';
import { GraphSyncQueueService } from '@modules/graph/graph-sync-queue.service';
import {
  trafficCellId,
} from '@modules/graph/graph-map-cell.util';
import { MapEngineCacheService } from '@modules/map-engine-cache/map-engine-cache.service';
import { MapEngineHistoryService } from '@modules/map-engine-cache/map-engine-history.service';
import { mapEtaCacheKey } from '@modules/map-engine-cache/map-engine-cache.keys';
import { TrafficFleetService } from './traffic-fleet.service';
import { TrafficExternalProviders } from './traffic-external.providers';

export type ResolveTrafficFactorArgs = {
  latitude: number;
  longitude: number;
  headingDegrees?: number | null;
  /** Région ISO2 optionnelle (settings locaux futurs). */
  countryCode?: string | null;
};

/**
 * Orchestrateur Traffic Engine — sélection pool admin + providers.
 */
@Injectable()
export class TrafficService {
  private readonly logger = new Logger(TrafficService.name);
  private _factorCache = new Map<
    string,
    { at: number; factor: number; engine: TrafficEnginePrimary }
  >();
  private static readonly CACHE_TTL_MS = 45_000;

  constructor(
    private readonly mapSettings: MapSettingsService,
    private readonly fleet: TrafficFleetService,
    private readonly external: TrafficExternalProviders,
    private readonly config: ConfigService,
    @Optional() private readonly graphMap?: GraphMapIntelligenceService,
    @Optional() private readonly graphSync?: GraphSyncQueueService,
    @Optional() private readonly mapCache?: MapEngineCacheService,
    @Optional() private readonly mapHistory?: MapEngineHistoryService,
  ) {}

  envFallbackFactor(): number {
    const raw = Number(
      this.config.get<string>('ETA_TRAFFIC_FACTOR') ??
        process.env.ETA_TRAFFIC_FACTOR ??
        1,
    );
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(2.5, Math.max(0.7, raw));
  }

  async resolveConfiguredEngine(
    countryCode?: string | null,
  ): Promise<{
    primary: TrafficEnginePrimary;
    pool: { engine: TrafficEngineId; weight: number }[];
  }> {
    const doc = await this.mapSettings.getSettingsDocument();
    const primary = normalizeTrafficEnginePrimary(
      (doc as { trafficEngine?: string }).trafficEngine,
    );
    const pool = resolveTrafficPool(
      (doc as { trafficEnginePool?: unknown }).trafficEnginePool,
      primary,
    );
    void countryCode;
    return { primary, pool };
  }

  /**
   * Facteur trafic pour ETA (≥1 = ralentissement).
   * Best-effort : jamais d’exception vers l’appelant.
   */
  async resolveTrafficFactor(
    args: ResolveTrafficFactorArgs,
  ): Promise<{ factor: number; engine: TrafficEnginePrimary }> {
    const lat = Number(args.latitude);
    const lng = Number(args.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { factor: this.envFallbackFactor(), engine: 'none' };
    }
    const memKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const memHit = this._factorCache.get(memKey);
    if (memHit && Date.now() - memHit.at < TrafficService.CACHE_TTL_MS) {
      return { factor: memHit.factor, engine: memHit.engine };
    }

    const redisKey = mapEtaCacheKey(lat, lng, 'tfactor');
    const redisTtl = this.mapCache?.ttlSec('eta') ?? 60;
    if (this.mapCache) {
      const redisHit = await this.mapCache.getJson<{
        factor: number;
        engine: TrafficEnginePrimary;
      }>(redisKey);
      if (
        redisHit &&
        Number.isFinite(redisHit.factor) &&
        redisHit.factor > 0
      ) {
        this._factorCache.set(memKey, {
          at: Date.now(),
          factor: redisHit.factor,
          engine: redisHit.engine,
        });
        return redisHit;
      }
    }

    try {
      const { primary, pool } = await this.resolveConfiguredEngine(
        args.countryCode,
      );
      if (primary === 'none' && !pool.length) {
        const factor = this.envFallbackFactor();
        this._factorCache.set(memKey, {
          at: Date.now(),
          factor,
          engine: 'none',
        });
        return { factor, engine: 'none' };
      }

      const isEligible = (engine: TrafficEngineId): boolean => {
        if (engine === 'fleet') return true;
        if (engine === 'tomtom') return true;
        if (engine === 'mapbox') return true;
        return false;
      };

      const picked = pickWeightedTrafficEngine(
        pool.length ? pool : primary === 'none' ? [] : [{ engine: primary, weight: 100 }],
        isEligible,
        primary,
      );

      let factor: number | null = null;
      if (picked === 'fleet') {
        factor = await this.fleet.resolveFactor(lat, lng);
      } else if (picked === 'tomtom') {
        factor = await this.external.resolveTomTomFactor(lat, lng);
      } else if (picked === 'mapbox') {
        factor = await this.external.resolveMapboxFactor(
          lat,
          lng,
          args.headingDegrees,
        );
      }

      if (factor == null && picked !== 'fleet') {
        factor = await this.fleet.resolveFactor(lat, lng);
      }
      if (factor == null && picked !== 'tomtom') {
        factor = await this.external.resolveTomTomFactor(lat, lng);
      }
      if (factor == null && picked !== 'mapbox') {
        factor = await this.external.resolveMapboxFactor(
          lat,
          lng,
          args.headingDegrees,
        );
      }

      if (factor == null) {
        factor = await this.graphMap?.averageTrafficFactorNear(lat, lng);
      }

      const resolved = factor ?? this.envFallbackFactor();
      const engine: TrafficEnginePrimary =
        factor != null ? (picked === 'none' ? 'fleet' : picked) : 'none';
      const out = { factor: resolved, engine };
      this._factorCache.set(memKey, { at: Date.now(), ...out });
      void this.mapCache?.setJson(redisKey, out, redisTtl);
      return out;
    } catch (e) {
      this.logger.debug(
        `resolveTrafficFactor: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { factor: this.envFallbackFactor(), engine: 'none' };
    }
  }

  /** Ingest télémétrie flotte (si moteur pool inclut fleet ou always on pour construction couche). */
  async ingestFleetTelemetry(args: {
    latitude: number;
    longitude: number;
    speedMps?: number | null;
    speedKmh?: number | null;
    headingDegrees?: number | null;
  }): Promise<void> {
    try {
      const { primary, pool } = await this.resolveConfiguredEngine();
      const wantsFleet =
        primary === 'fleet' ||
        pool.some((e) => e.engine === 'fleet') ||
        // Collecte passive même si primary none — construit la couche « weeks ».
        String(
          this.config.get('TRAFFIC_FLEET_ALWAYS_COLLECT') ??
            process.env.TRAFFIC_FLEET_ALWAYS_COLLECT ??
            'true',
        )
          .trim()
          .toLowerCase() !== 'false';
      if (!wantsFleet) return;
      await this.fleet.ingestPing(args);

      // Neo4j traffic prediction graph (cellules) — throttle via queue jobId.
      const lat = Number(args.latitude);
      const lng = Number(args.longitude);
      let speedKmh =
        typeof args.speedKmh === 'number' && Number.isFinite(args.speedKmh)
          ? args.speedKmh
          : null;
      if (
        speedKmh == null &&
        typeof args.speedMps === 'number' &&
        Number.isFinite(args.speedMps) &&
        args.speedMps >= 0
      ) {
        speedKmh = args.speedMps * 3.6;
      }
      const cellId = trafficCellId(lat, lng);
      if (cellId && speedKmh != null && speedKmh > 0.5) {
        void this.graphSync?.enqueueTrafficSample({
          cellId,
          latitude: lat,
          longitude: lng,
          speedKmh,
          headingDegrees: args.headingDegrees,
          at: new Date().toISOString(),
        });
        void this.mapHistory?.maybeRecordTrafficSample({
          latitude: lat,
          longitude: lng,
          speedKmh,
          headingDegrees: args.headingDegrees,
          source: 'fleet',
        });
      }
    } catch {
      // ignore
    }
  }
}
