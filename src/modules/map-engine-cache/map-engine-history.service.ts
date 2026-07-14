import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MapProviderStatModel } from '@schemas/map-provider-stat.schema';
import { MapTrafficSampleModel } from '@schemas/map-traffic-sample.schema';
import { MapHistoricalRouteModel } from '@schemas/map-historical-route.schema';
import { MapCourierGpsHistoryModel } from '@schemas/map-courier-gps-history.schema';
import { trafficCellId } from '@modules/graph/graph-map-cell.util';
import { trafficFactorFromAvgSpeedKmh } from '@modules/graph/graph-map-cell.util';
import type { MapCacheKind } from './map-engine-cache.keys';
import { hashMapCacheParts } from './map-engine-cache.keys';

function dayKeyUtc(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Mongo L2 — historique / stats providers map.
 * Écritures best-effort, throttle GPS / trafic.
 */
@Injectable()
export class MapEngineHistoryService {
  private readonly logger = new Logger(MapEngineHistoryService.name);
  private readonly lastTrafficWriteMs = new Map<string, number>();
  private readonly lastGpsWriteMs = new Map<string, number>();
  private readonly pendingStatDeltas = new Map<
    string,
    {
      cacheHits: number;
      cacheMisses: number;
      externalCalls: number;
      externalErrors: number;
      totalLatencyMs: number;
    }
  >();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(MapProviderStatModel.name)
    private readonly stats: Model<MapProviderStatModel>,
    @InjectModel(MapTrafficSampleModel.name)
    private readonly trafficSamples: Model<MapTrafficSampleModel>,
    @InjectModel(MapHistoricalRouteModel.name)
    private readonly historicalRoutes: Model<MapHistoricalRouteModel>,
    @InjectModel(MapCourierGpsHistoryModel.name)
    private readonly gpsHistory: Model<MapCourierGpsHistoryModel>,
  ) {
    this.flushTimer = setInterval(() => {
      void this.flushStatDeltas();
    }, 15_000);
    this.flushTimer.unref?.();
  }

  private historyEnabled(): boolean {
    const raw =
      this.config.get<string>('MAP_HISTORY_ENABLED') ??
      process.env.MAP_HISTORY_ENABLED ??
      'true';
    return String(raw).trim().toLowerCase() !== 'false';
  }

  private trafficSampleIntervalMs(): number {
    const n = Number(
      this.config.get<string>('MAP_TRAFFIC_SAMPLE_INTERVAL_MS') ??
        process.env.MAP_TRAFFIC_SAMPLE_INTERVAL_MS ??
        300_000,
    );
    if (!Number.isFinite(n) || n < 60_000) return 300_000;
    return Math.min(3_600_000, Math.trunc(n));
  }

  private gpsHistoryIntervalMs(): number {
    const n = Number(
      this.config.get<string>('MAP_GPS_HISTORY_INTERVAL_MS') ??
        process.env.MAP_GPS_HISTORY_INTERVAL_MS ??
        300_000,
    );
    if (!Number.isFinite(n) || n < 60_000) return 300_000;
    return Math.min(3_600_000, Math.trunc(n));
  }

  async recordCacheHit(args: {
    engine: string;
    kind: MapCacheKind;
  }): Promise<void> {
    this.bumpStat(args.engine, args.kind, { cacheHits: 1 });
  }

  async recordCacheMiss(args: {
    engine: string;
    kind: MapCacheKind;
  }): Promise<void> {
    this.bumpStat(args.engine, args.kind, { cacheMisses: 1 });
  }

  async recordExternalOk(args: {
    engine: string;
    kind: MapCacheKind;
    latencyMs: number;
  }): Promise<void> {
    this.bumpStat(args.engine, args.kind, {
      externalCalls: 1,
      totalLatencyMs: Math.max(0, Math.trunc(args.latencyMs)),
    });
  }

  async recordExternalError(args: {
    engine: string;
    kind: MapCacheKind;
    latencyMs: number;
  }): Promise<void> {
    this.bumpStat(args.engine, args.kind, {
      externalErrors: 1,
      totalLatencyMs: Math.max(0, Math.trunc(args.latencyMs)),
    });
  }

  private bumpStat(
    engine: string,
    kind: MapCacheKind,
    delta: Partial<{
      cacheHits: number;
      cacheMisses: number;
      externalCalls: number;
      externalErrors: number;
      totalLatencyMs: number;
    }>,
  ): void {
    if (!this.historyEnabled()) return;
    const key = `${dayKeyUtc()}|${engine}|${kind}`;
    const prev = this.pendingStatDeltas.get(key) ?? {
      cacheHits: 0,
      cacheMisses: 0,
      externalCalls: 0,
      externalErrors: 0,
      totalLatencyMs: 0,
    };
    prev.cacheHits += delta.cacheHits ?? 0;
    prev.cacheMisses += delta.cacheMisses ?? 0;
    prev.externalCalls += delta.externalCalls ?? 0;
    prev.externalErrors += delta.externalErrors ?? 0;
    prev.totalLatencyMs += delta.totalLatencyMs ?? 0;
    this.pendingStatDeltas.set(key, prev);
  }

  async flushStatDeltas(): Promise<void> {
    if (!this.pendingStatDeltas.size) return;
    const entries = [...this.pendingStatDeltas.entries()];
    this.pendingStatDeltas.clear();
    for (const [key, delta] of entries) {
      const [day, engine, kind] = key.split('|');
      try {
        await this.stats.updateOne(
          { dayKey: day, engine, kind },
          {
            $inc: {
              cacheHits: delta.cacheHits,
              cacheMisses: delta.cacheMisses,
              externalCalls: delta.externalCalls,
              externalErrors: delta.externalErrors,
              totalLatencyMs: delta.totalLatencyMs,
            },
            $setOnInsert: { dayKey: day, engine, kind },
          },
          { upsert: true },
        );
      } catch (err) {
        this.logger.debug(
          `stat flush: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Persist trafic throttlé (défaut 5 min / cellule). */
  async maybeRecordTrafficSample(args: {
    latitude: number;
    longitude: number;
    speedKmh: number;
    headingDegrees?: number | null;
    source?: string;
  }): Promise<void> {
    if (!this.historyEnabled()) return;
    const cellId = trafficCellId(args.latitude, args.longitude);
    if (!cellId) return;
    const now = Date.now();
    const last = this.lastTrafficWriteMs.get(cellId) ?? 0;
    if (now - last < this.trafficSampleIntervalMs()) return;
    this.lastTrafficWriteMs.set(cellId, now);
    try {
      await this.trafficSamples.create({
        cellId,
        latitude: args.latitude,
        longitude: args.longitude,
        speedKmh: args.speedKmh,
        headingDegrees: args.headingDegrees ?? null,
        factor: trafficFactorFromAvgSpeedKmh(args.speedKmh),
        source: args.source ?? 'fleet',
        sampledAt: new Date(),
      });
    } catch (err) {
      this.logger.debug(
        `traffic sample: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Upsert résumé matrice / route après miss→fetch. */
  async recordHistoricalRoute(args: {
    engine: string;
    kind: 'matrix' | 'route' | 'distance';
    fingerprintParts: string[];
    pointCount: number;
    durationSeconds?: number | null;
    distanceMeters?: number | null;
  }): Promise<void> {
    if (!this.historyEnabled()) return;
    const fingerprint = hashMapCacheParts(
      args.engine,
      args.kind,
      ...args.fingerprintParts,
    );
    try {
      await this.historicalRoutes.updateOne(
        { fingerprint },
        {
          $set: {
            engine: args.engine,
            kind: args.kind,
            pointCount: args.pointCount,
            durationSeconds: args.durationSeconds ?? null,
            distanceMeters: args.distanceMeters ?? null,
            lastUsedAt: new Date(),
          },
          $inc: { useCount: 1 },
          $setOnInsert: { fingerprint },
        },
        { upsert: true },
      );
    } catch (err) {
      this.logger.debug(
        `historical route: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Échantillon GPS historique throttlé (défaut 5 min / livreur). */
  async maybeRecordGpsSample(args: {
    agentUserId: string;
    latitude: number;
    longitude: number;
    speedMps?: number | null;
    headingDegrees?: number | null;
    region?: string | null;
  }): Promise<void> {
    if (!this.historyEnabled()) return;
    const id = String(args.agentUserId ?? '').trim();
    if (!id) return;
    const now = Date.now();
    const last = this.lastGpsWriteMs.get(id) ?? 0;
    if (now - last < this.gpsHistoryIntervalMs()) return;
    this.lastGpsWriteMs.set(id, now);
    try {
      await this.gpsHistory.create({
        agentUserId: id,
        latitude: args.latitude,
        longitude: args.longitude,
        speedMps:
          typeof args.speedMps === 'number' && Number.isFinite(args.speedMps)
            ? args.speedMps
            : null,
        headingDegrees: args.headingDegrees ?? null,
        region: args.region ?? null,
        recordedAt: new Date(),
      });
    } catch (err) {
      this.logger.debug(
        `gps history: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
