import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
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
import { Model } from 'mongoose';

export type GeocodeEngine = 'osm' | 'mapbox' | 'google';

export type GeocodeCacheLookupArgs = {
  kind: GeocodeCacheKind;
  query: string;
  countryCode: string;
  limit?: number;
  proximity?: string;
  bbox?: string;
};

@Injectable()
export class GeocodeCacheService {
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @InjectModel(GeocodeCacheEntryModel.name)
    private readonly model: Model<GeocodeCacheEntryDocument>,
    private readonly config: ConfigService,
  ) {}

  buildKey(args: GeocodeCacheLookupArgs): string {
    return buildGeocodeCacheKey(args);
  }

  canPersistEngine(engine: GeocodeEngine): boolean {
    if (engine === 'osm') return true;
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

  async lookup<T>(
    args: GeocodeCacheLookupArgs,
  ): Promise<{ payload: T; engine: GeocodeEngine } | null> {
    const cacheKey = this.buildKey(args);
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

  async store(
    args: GeocodeCacheLookupArgs & {
      engine: GeocodeEngine;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!this.canPersistEngine(args.engine)) return;
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
