import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  GeocodeCacheStore,
  normalizeGeocodeCacheStorePriority,
} from '@common/geocode-cache-store.util';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  buildGeocodeCacheKey,
  GeocodeCacheKind,
  normalizeGeocodeQuery,
  normalizeCountryCode,
} from '@common/normalize-geocode-query.util';
import {
  GeocodeCacheEntryDocument,
  GeocodeCacheEntryModel,
} from '@schemas/geocode-cache-entry.schema';
import { MapSettingsService } from '@modules/map-settings/map-settings.service';
import { Model } from 'mongoose';

export type GeocodeEngine =
  'osm' | 'mapsco' | 'locationiq' | 'tomtom' | 'mapbox' | 'google';

export type GeocodeCacheLookupArgs = {
  kind: GeocodeCacheKind;
  query: string;
  countryCode: string;
  limit?: number;
  proximity?: string;
  bbox?: string;
};

type VolatileCacheEntry = {
  engine: GeocodeEngine;
  payload: Record<string, unknown>;
};

@Injectable()
export class GeocodeCacheService {
  private readonly logger = new Logger(GeocodeCacheService.name);
  private readonly inflight = new Map<string, Promise<unknown>>();
  private priorityCache: { at: number; value: GeocodeCacheStore[] } | null =
    null;
  private static readonly PRIORITY_TTL_MS = 30_000;
  private readonly volatileTtlMs: number;

  constructor(
    @InjectModel(GeocodeCacheEntryModel.name)
    private readonly model: Model<GeocodeCacheEntryDocument>,
    private readonly config: ConfigService,
    private readonly mapSettings: MapSettingsService,
    private readonly moduleCache: ModuleCacheLayerService,
  ) {
    const raw = Number(this.config.get<string>('GEOCODE_CACHE_TTL_MS'));
    this.volatileTtlMs =
      Number.isFinite(raw) && raw >= 60_000 ? raw : 7 * 24 * 60 * 60 * 1000;
  }

  buildKey(args: GeocodeCacheLookupArgs): string {
    return buildGeocodeCacheKey(args);
  }

  canPersistEngine(engine: GeocodeEngine): boolean {
    if (
      engine === 'osm' ||
      engine === 'mapsco' ||
      engine === 'locationiq' ||
      engine === 'tomtom'
    ) {
      return true;
    }
    if (engine === 'google') return false;
    if (engine === 'mapbox') {
      return (
        String(
          this.config.get<string>('MAPBOX_GEOCODE_STORAGE_ALLOWED') ?? '',
        ).trim()
          .toLowerCase() === 'true'
      );
    }
    return false;
  }

  private volatileKey(cacheKey: string): string {
    return `geocode:v1:${cacheKey}`;
  }

  private isStoreAvailable(store: GeocodeCacheStore): boolean {
    if (store === 'mongodb') return true;
    if (store === 'redis') return this.moduleCache.isEngineAvailable('redis');
    if (store === 'memcached') {
      return this.moduleCache.isEngineAvailable('memcached');
    }
    return false;
  }

  private async getStorePriority(): Promise<GeocodeCacheStore[]> {
    const now = Date.now();
    if (
      this.priorityCache &&
      now - this.priorityCache.at < GeocodeCacheService.PRIORITY_TTL_MS
    ) {
      return this.priorityCache.value;
    }
    const doc = await this.mapSettings.getSettingsDocument();
    const value = normalizeGeocodeCacheStorePriority(
      doc.geocodeCacheStorePriority,
    );
    this.priorityCache = { at: now, value };
    return value;
  }

  private async lookupVolatile<T>(
    store: Exclude<GeocodeCacheStore, 'mongodb'>,
    cacheKey: string,
  ): Promise<{ payload: T; engine: GeocodeEngine } | null> {
    const cache = this.moduleCache.cacheForEngine(store);
    try {
      const raw = await cache.get<VolatileCacheEntry>(
        this.volatileKey(cacheKey),
      );
      if (!raw?.payload) return null;
      const engine = (raw.engine as GeocodeEngine) || 'osm';
      return { payload: raw.payload as T, engine };
    } catch (err) {
      this.logger.warn(
        `Geocode cache read failed (${store}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async storeVolatile(
    store: Exclude<GeocodeCacheStore, 'mongodb'>,
    cacheKey: string,
    engine: GeocodeEngine,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const cache = this.moduleCache.cacheForEngine(store);
    try {
      await cache.set(
        this.volatileKey(cacheKey),
        { engine, payload } satisfies VolatileCacheEntry,
        this.volatileTtlMs,
      );
    } catch (err) {
      this.logger.warn(
        `Geocode cache write failed (${store}): ${(err as Error).message}`,
      );
    }
  }

  private async lookupMongo<T>(
    cacheKey: string,
  ): Promise<{ payload: T; engine: GeocodeEngine } | null> {
    const doc = await this.model.findOne({ cacheKey }).lean().exec();
    if (!doc?.payload) return null;
    await this.model
      .updateOne(
        { cacheKey },
        {
          $inc: { hitCount: 1 },
          $set: { lastHitAt: new Date() },
        },
      )
      .exec();
    const engine = (doc.engine as GeocodeEngine) || 'osm';
    return { payload: doc.payload as T, engine };
  }

  private async storeMongo(
    args: GeocodeCacheLookupArgs & {
      engine: GeocodeEngine;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const cacheKey = this.buildKey(args);
    const normalizedQuery = normalizeGeocodeQuery(args.query);
    const countryCode = normalizeCountryCode(args.countryCode) || 'XX';
    await this.model
      .updateOne(
        { cacheKey },
        {
          $set: {
            cacheKey,
            kind: args.kind,
            normalizedQuery,
            countryCode,
            engine: args.engine,
            payload: args.payload,
            lastHitAt: new Date(),
          },
          $setOnInsert: { hitCount: 0 },
        },
        { upsert: true },
      )
      .exec();
  }

  async lookup<T>(
    args: GeocodeCacheLookupArgs,
  ): Promise<{ payload: T; engine: GeocodeEngine } | null> {
    const cacheKey = this.buildKey(args);
    const priority = await this.getStorePriority();
    for (const store of priority) {
      if (!this.isStoreAvailable(store)) continue;
      if (store === 'mongodb') {
        const hit = await this.lookupMongo<T>(cacheKey);
        if (hit) return hit;
        continue;
      }
      const hit = await this.lookupVolatile<T>(store, cacheKey);
      if (hit) return hit;
    }
    return null;
  }

  async store(
    args: GeocodeCacheLookupArgs & {
      engine: GeocodeEngine;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!this.canPersistEngine(args.engine)) return;
    const cacheKey = this.buildKey(args);
    const priority = await this.getStorePriority();
    for (const store of priority) {
      if (!this.isStoreAvailable(store)) continue;
      if (store === 'mongodb') {
        await this.storeMongo(args);
      } else {
        await this.storeVolatile(store, cacheKey, args.engine, args.payload);
      }
      return;
    }
  }

  async dedupe<T>(
    args: GeocodeCacheLookupArgs,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.lookup<T>(args);
    if (cached !== null) return cached.payload;

    const cacheKey = this.buildKey(args);
    const pending = this.inflight.get(cacheKey);
    if (pending) return pending as Promise<T>;

    const promise = loader().finally(() => {
      this.inflight.delete(cacheKey);
    });
    this.inflight.set(cacheKey, promise);
    return promise;
  }
}
