import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SharedRedisService } from '@common/redis/shared-redis.service';
import type { MapCacheKind } from './map-engine-cache.keys';
import { parseMapCacheTtlSec } from './map-engine-cache.keys';
import { MapEngineHistoryService } from './map-engine-history.service';

type MemEntry = { exp: number; value: string };

/**
 * Redis L1 Multi-Level Cache map engine.
 * Fail-open mémoire process si Redis down. Mongo L2 via history (async).
 */
@Injectable()
export class MapEngineCacheService {
  private readonly logger = new Logger(MapEngineCacheService.name);
  private readonly memory = new Map<string, MemEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: ConfigService,
    private readonly sharedRedis: SharedRedisService,
    @Optional() private readonly history?: MapEngineHistoryService,
  ) {}

  ttlSec(kind: MapCacheKind): number {
    const envKey =
      kind === 'matrix'
        ? 'MAP_MATRIX_CACHE_TTL_SEC'
        : kind === 'route'
          ? 'MAP_ROUTE_CACHE_TTL_SEC'
          : kind === 'eta'
            ? 'MAP_ETA_CACHE_TTL_SEC'
            : kind === 'traffic'
              ? 'MAP_TRAFFIC_CACHE_TTL_SEC'
              : kind === 'distance'
                ? 'MAP_DISTANCE_CACHE_TTL_SEC'
                : 'MAP_ADDRESS_CACHE_TTL_SEC';
    return parseMapCacheTtlSec(
      kind,
      this.config.get<string>(envKey) ?? process.env[envKey],
    );
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.getRaw(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSec: number,
  ): Promise<void> {
    let payload: string;
    try {
      payload = JSON.stringify(value);
    } catch {
      return;
    }
    await this.setRaw(key, payload, ttlSec);
  }

  /**
   * Cache-aside + dédup inflight. Jamais d’exception vers l’appelant métier.
   */
  async getOrSetJson<T>(
    key: string,
    ttlSec: number,
    factory: () => Promise<T | null>,
    meta?: { engine?: string; kind?: MapCacheKind },
  ): Promise<T | null> {
    const hit = await this.getJson<T>(key);
    if (hit != null) {
      void this.history?.recordCacheHit({
        engine: meta?.engine ?? 'unknown',
        kind: meta?.kind ?? 'matrix',
      });
      return hit;
    }

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T | null>;

    const task = (async () => {
      const started = Date.now();
      try {
        void this.history?.recordCacheMiss({
          engine: meta?.engine ?? 'unknown',
          kind: meta?.kind ?? 'matrix',
        });
        const value = await factory();
        const latency = Date.now() - started;
        if (value != null) {
          await this.setJson(key, value, ttlSec);
          void this.history?.recordExternalOk({
            engine: meta?.engine ?? 'unknown',
            kind: meta?.kind ?? 'matrix',
            latencyMs: latency,
          });
        } else {
          void this.history?.recordExternalError({
            engine: meta?.engine ?? 'unknown',
            kind: meta?.kind ?? 'matrix',
            latencyMs: latency,
          });
        }
        return value;
      } catch (err) {
        void this.history?.recordExternalError({
          engine: meta?.engine ?? 'unknown',
          kind: meta?.kind ?? 'matrix',
          latencyMs: Date.now() - started,
        });
        this.logger.debug(
          `map cache factory ${key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, task);
    return task;
  }

  private async getRaw(key: string): Promise<string | null> {
    const mem = this.memory.get(key);
    if (mem) {
      if (mem.exp > Date.now()) return mem.value;
      this.memory.delete(key);
    }
    try {
      if (!this.sharedRedis.isConfigured()) return null;
      await this.sharedRedis.ensureConnected();
      const redis = this.sharedRedis.getClient();
      if (!redis) return null;
      return await redis.get(key);
    } catch {
      return null;
    }
  }

  private async setRaw(
    key: string,
    value: string,
    ttlSec: number,
  ): Promise<void> {
    const ttl = Math.max(5, Math.trunc(ttlSec));
    this.memory.set(key, { value, exp: Date.now() + ttl * 1000 });
    if (this.memory.size > 2_000) {
      const first = this.memory.keys().next().value;
      if (first) this.memory.delete(first);
    }
    try {
      if (!this.sharedRedis.isConfigured()) return;
      await this.sharedRedis.ensureConnected();
      const redis = this.sharedRedis.getClient();
      if (!redis) return;
      await redis.set(key, value, 'EX', ttl);
    } catch {
      /* fail-open mémoire */
    }
  }
}
