import {
  GeocodeFeature,
  mapboxV6ToFeature,
  nominatimToFeature,
  structuredSearchToFeature,
} from '@common/geocode-feature.util';
import {
  countryMapboxBboxParam,
  geocodeProximityForCountry,
} from '@common/geocode-region.util';
import {
  normalizeCountryCode,
  normalizeGeocodeQuery,
  normalizePostalCode,
} from '@common/normalize-geocode-query.util';
import {
  locationIqForwardGeocode,
  locationIqReverseGeocode,
  locationIqSearchStructuredAddress,
  resolveLocationIqAccessToken,
} from '@common/locationiq-geocoding.util';
import {
  mapsCoForwardGeocode,
  mapsCoReverseGeocode,
  mapsCoSearchStructuredAddress,
  resolveMapsCoGeocodingApiKey,
} from '@common/maps-co-geocoding.util';
import {
  tomtomForwardGeocode,
  tomtomReverseGeocode,
  tomtomSearchStructuredAddress,
  resolveTomTomGeocodingApiKey,
} from '@common/tomtom-geocoding.util';
import type { OsmGeocodeResult } from '@common/osm-geocoding.util';
import {
  osmForwardGeocode,
  osmReverseGeocode,
  osmSearchStructuredAddress,
} from '@common/osm-geocoding.util';
import {
  resolveMapboxGeocodeApiUrl,
  resolveMapboxGeocodingToken,
} from '@common/mapbox-geocoding.util';
import {
  GeocodingEngineId,
  pickWeightedGeocodingEngine,
} from '@common/geocoding-engine-pool.util';
import { MapSettingsService } from '@modules/map-settings/map-settings.service';
import {
  MapSettingsGroupKey,
  geocodingEngineForGroup,
  geocodingEnginePoolForGroup,
  isEngineEnabledForGroup,
  resolveMapSettingsForRegion,
} from '@modules/map-settings/map-settings-region.util';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserModel } from '@schemas/user.schema';
import axios from 'axios';
import { MapGeocodeUsageTracker } from '@common/map-geocode/map-geocode-usage.tracker';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { GeocodeCacheService, GeocodeEngine } from './geocode-cache.service';

type ForwardArgs = {
  query: string;
  countryCode: string;
  limit?: number;
  proximityLng?: number;
  proximityLat?: number;
  context?: MapSettingsGroupKey;
  storeId?: string;
  autocomplete?: boolean;
};

type ReverseArgs = {
  lat: number;
  lng: number;
  countryCode: string;
  context?: MapSettingsGroupKey;
  storeId?: string;
};

type StructuredArgs = {
  address: string;
  city: string;
  country: string;
  zipCode: string;
  countryCode: string;
};

export type StructuredGeocodeResult = {
  address: string;
  country: string;
  countryCode: string;
  zipCode: string;
  city: string;
  location: [number, number];
  cached?: boolean;
  engine?: GeocodeEngine;
  feature?: GeocodeFeature | null;
};

@Injectable()
export class GeocodeService {
  constructor(
    private readonly cache: GeocodeCacheService,
    private readonly mapSettings: MapSettingsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
    private readonly secrets: SecretManagerService,
    private readonly usage: MapGeocodeUsageTracker,
  ) {}

  async forward(
    args: ForwardArgs,
    user?: UserModel,
  ): Promise<{ features: GeocodeFeature[]; cached: boolean; engine: GeocodeEngine }> {
    const countryCode = this.resolveCountryCode(args.countryCode, user);
    const context = args.context ?? 'mobileUser';
    const limit = args.limit ?? 5;
    const query = args.query.trim();
    const proximity = this.formatProximity(
      args.proximityLng,
      args.proximityLat,
      countryCode,
    );
    const bbox = countryMapboxBboxParam(countryCode) ?? '';
    const cacheArgs = {
      kind: 'forward' as const,
      query,
      countryCode,
      limit,
      proximity,
      bbox,
    };

    const cached = await this.cache.lookup<{ features: GeocodeFeature[] }>(
      cacheArgs,
    );
    if (cached?.payload?.features?.length) {
      this.recordUsage('forward', cached.engine, 'cache_hit', context);
      return {
        features: cached.payload.features,
        cached: true,
        engine: cached.engine,
      };
    }

    const engine = await this.resolveEngine(countryCode, context, user, args.storeId);
    const payload = await this.cache.dedupe(cacheArgs, async () => {
      const features = await this.fetchForward(engine, {
        query,
        countryCode,
        limit,
        proximityLng: args.proximityLng,
        proximityLat: args.proximityLat,
        autocomplete: args.autocomplete ?? true,
      });
      return { features };
    });

    await this.cache.store({
      ...cacheArgs,
      engine,
      payload: payload as Record<string, unknown>,
    });

    this.recordUsage('forward', engine, 'external', context);
    return {
      features: payload.features ?? [],
      cached: false,
      engine,
    };
  }

  async reverse(
    args: ReverseArgs,
    user?: UserModel,
  ): Promise<{ feature: GeocodeFeature | null; cached: boolean; engine: GeocodeEngine }> {
    const countryCode = this.resolveCountryCode(args.countryCode, user);
    const context = args.context ?? 'mobileUser';
    const query = `${args.lng.toFixed(5)},${args.lat.toFixed(5)}`;
    const cacheArgs = {
      kind: 'reverse' as const,
      query,
      countryCode,
      limit: 1,
    };

    const cached = await this.cache.lookup<{ feature: GeocodeFeature | null }>(
      cacheArgs,
    );
    if (cached) {
      this.recordUsage('reverse', cached.engine, 'cache_hit', context);
      return {
        feature: cached.payload.feature ?? null,
        cached: true,
        engine: cached.engine,
      };
    }

    const engine = await this.resolveEngine(countryCode, context, user, args.storeId);
    const payload = await this.cache.dedupe(cacheArgs, async () => {
      const feature = await this.fetchReverse(engine, args.lat, args.lng);
      return { feature };
    });

    await this.cache.store({
      ...cacheArgs,
      engine,
      payload: payload as Record<string, unknown>,
    });

    this.recordUsage('reverse', engine, 'external', context);
    return {
      feature: payload.feature ?? null,
      cached: false,
      engine,
    };
  }

  async searchStructured(
    args: StructuredArgs,
    user?: UserModel,
  ): Promise<StructuredGeocodeResult> {
    const countryCode =
      normalizeCountryCode(args.countryCode) ||
      this.resolveCountryCode(undefined, user);
    const query = [args.address, args.city, args.country, args.zipCode]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .join(', ');
    const cacheArgs = {
      kind: 'structured' as const,
      query,
      countryCode,
      limit: 1,
    };

    const cached = await this.cache.lookup<{ result: Record<string, unknown> }>(
      cacheArgs,
    );
    if (cached?.payload?.result) {
      this.recordUsage('structured', cached.engine, 'cache_hit', 'mobileUser');
      return {
        ...(cached.payload.result as StructuredGeocodeResult),
        cached: true,
        engine: cached.engine,
      };
    }

    const engine = await this.resolveEngine(countryCode, 'mobileUser');
    const payload = await this.cache.dedupe(cacheArgs, async () => {
      const result = await this.fetchStructured(engine, {
        ...args,
        countryCode,
      });
      return { result };
    });

    await this.cache.store({
      ...cacheArgs,
      engine,
      payload: payload as Record<string, unknown>,
    });

    this.recordUsage('structured', engine, 'external', 'mobileUser');
    return {
      ...(payload.result as StructuredGeocodeResult),
      cached: false,
      engine,
    };
  }

  private recordUsage(
    operation: 'forward' | 'reverse' | 'structured',
    engine: GeocodeEngine,
    source: 'cache_hit' | 'external',
    context: MapSettingsGroupKey,
  ): void {
    this.usage.record({
      operation,
      engine,
      source,
      context,
    });
  }

  private resolveCountryCode(raw?: string, user?: UserModel): string {
    return (
      normalizeCountryCode(raw) ||
      normalizeCountryCode(user?.appCountryCode) ||
      'CA'
    );
  }

  private formatProximity(
    lng?: number,
    lat?: number,
    countryCode?: string,
  ): string {
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      return `${Number(lng).toFixed(4)},${Number(lat).toFixed(4)}`;
    }
    const center = geocodeProximityForCountry(countryCode);
    return `${center.lng.toFixed(4)},${center.lat.toFixed(4)}`;
  }

  private async resolveEngine(
    countryCode: string,
    context: MapSettingsGroupKey,
    user?: UserModel,
    storeId?: string,
  ): Promise<GeocodeEngine> {
    const envEngine = String(
      this.config.get<string>('MAP_GEOCODING_ENGINE') ?? '',
    )
      .trim()
      .toLowerCase();
    if (envEngine === 'osm') return 'osm';

    const doc = await this.mapSettings.getSettingsDocument();
    const merged = resolveMapSettingsForRegion(doc, countryCode);
    const hasMapbox = Boolean(
      await resolveMapboxGeocodingToken(this.secrets, this.config),
    );
    const googleKey = String(
      this.config.get<string>('GOOGLE_MAPS_API_KEY') ??
        process.env.GOOGLE_MAPS_API_KEY ??
        '',
    ).trim();
    const mapsCoKey = await resolveMapsCoGeocodingApiKey(
      this.secrets,
      this.config,
    );
    const locationIqKey = await resolveLocationIqAccessToken(
      this.secrets,
      this.config,
    );
    const tomtomKey = await resolveTomTomGeocodingApiKey(
      this.secrets,
      this.config,
    );

    const isAvailable = (engine: GeocodingEngineId): boolean => {
      if (!isEngineEnabledForGroup(merged, context, engine)) return false;
      if (engine === 'mapbox') return hasMapbox;
      if (engine === 'google') return Boolean(googleKey);
      if (engine === 'mapsco') return Boolean(mapsCoKey);
      if (engine === 'locationiq') return Boolean(locationIqKey);
      if (engine === 'tomtom') return Boolean(tomtomKey);
      return true;
    };

    const pool =
      context === 'vendor'
        ? await this.resolveVendorGeocodingPool(merged, user, storeId)
        : geocodingEnginePoolForGroup(merged, context);
    const fallback = await this.resolveGeocodingFallback(
      merged,
      context,
      user,
      storeId,
    );
    const picked = pickWeightedGeocodingEngine(
      pool,
      isAvailable,
      isAvailable(fallback) ? fallback : 'osm',
    );
    if (isAvailable(picked)) return picked;
    if (isAvailable('osm')) return 'osm';
    if (isAvailable('mapsco')) return 'mapsco';
    if (isAvailable('locationiq')) return 'locationiq';
    if (isAvailable('tomtom')) return 'tomtom';
    if (isAvailable('mapbox')) return 'mapbox';
    if (isAvailable('google')) return 'google';
    return 'osm';
  }

  private async resolveGeocodingFallback(
    merged: ReturnType<typeof resolveMapSettingsForRegion>,
    context: MapSettingsGroupKey,
    user?: UserModel,
    storeId?: string,
  ): Promise<GeocodingEngineId> {
    if (context !== 'vendor') {
      return geocodingEngineForGroup(merged, context);
    }
    const planCfg = await this.resolveVendorGeocodingConfig(user, storeId);
    if (planCfg.pool.length) return planCfg.fallback;
    return geocodingEngineForGroup(merged, 'vendor');
  }

  private async resolveVendorGeocodingConfig(
    user?: UserModel,
    storeId?: string,
  ): Promise<{ pool: ReturnType<typeof geocodingEnginePoolForGroup>; fallback: GeocodingEngineId }> {
    const resolvedStoreId = await this.subscriptions.resolveVendorStoreIdForGeocode(
      user,
      storeId,
    );
    if (resolvedStoreId) {
      return this.subscriptions.resolveVendorGeocodingForStore(resolvedStoreId);
    }
    return { pool: [], fallback: 'osm' };
  }

  private async resolveVendorGeocodingPool(
    merged: ReturnType<typeof resolveMapSettingsForRegion>,
    user?: UserModel,
    storeId?: string,
  ): Promise<ReturnType<typeof geocodingEnginePoolForGroup>> {
    const planCfg = await this.resolveVendorGeocodingConfig(user, storeId);
    if (planCfg.pool.length) return planCfg.pool;
    return geocodingEnginePoolForGroup(merged, 'vendor');
  }

  private nominatimRowsToFeatures(
    rows: OsmGeocodeResult[],
    idPrefix: string,
  ): GeocodeFeature[] {
    return rows.map((row) => {
      const location: [number, number] = [row.longitude, row.latitude];
      const display = [row.address, row.city, row.zipCode, row.country]
        .map((s) => String(s ?? '').trim())
        .filter(Boolean)
        .join(', ');
      return {
        id: `${idPrefix}.${row.longitude},${row.latitude}`,
        place_name: display || row.address,
        center: location,
        text: row.address,
        context: [
          ...(row.zipCode
            ? [{ id: 'postcode.0', text: row.zipCode }]
            : []),
          ...(row.city ? [{ id: 'place.0', text: row.city }] : []),
          ...(row.country
            ? [
                {
                  id: 'country.0',
                  text: row.country,
                  short_code: row.countryCode.toLowerCase(),
                },
              ]
            : []),
        ],
        geometry: { type: 'Point', coordinates: location },
      } satisfies GeocodeFeature;
    });
  }

  private async fetchForward(
    engine: GeocodeEngine,
    args: ForwardArgs & { autocomplete: boolean },
  ): Promise<GeocodeFeature[]> {
    if (engine === 'mapbox') {
      return this.fetchMapboxForward(args);
    }
    if (engine === 'mapsco') {
      const apiKey = await resolveMapsCoGeocodingApiKey(
        this.secrets,
        this.config,
      );
      if (!apiKey) return [];
      const rows = await mapsCoForwardGeocode(
        args.query,
        apiKey,
        this.config,
        {
          limit: args.limit ?? 5,
          countryCode: args.countryCode,
        },
      );
      return this.nominatimRowsToFeatures(rows, 'mapsco');
    }
    if (engine === 'locationiq') {
      const accessToken = await resolveLocationIqAccessToken(
        this.secrets,
        this.config,
      );
      if (!accessToken) return [];
      const rows = await locationIqForwardGeocode(
        args.query,
        accessToken,
        this.config,
        {
          limit: args.limit ?? 5,
          countryCode: args.countryCode,
        },
      );
      return this.nominatimRowsToFeatures(rows, 'locationiq');
    }
    if (engine === 'tomtom') {
      const apiKey = await resolveTomTomGeocodingApiKey(
        this.secrets,
        this.config,
      );
      if (!apiKey) return [];
      const rows = await tomtomForwardGeocode(
        args.query,
        apiKey,
        this.config,
        {
          limit: args.limit ?? 5,
          countryCode: args.countryCode,
          proximityLat: args.proximityLat,
          proximityLng: args.proximityLng,
        },
      );
      return this.nominatimRowsToFeatures(rows, 'tomtom');
    }
    const rows = await osmForwardGeocode(args.query, this.config, {
      limit: args.limit ?? 5,
      countryCode: args.countryCode,
    });
    return this.nominatimRowsToFeatures(rows, 'osm');
  }

  private async fetchMapboxForward(
    args: ForwardArgs & { autocomplete: boolean },
  ): Promise<GeocodeFeature[]> {
    const token = await resolveMapboxGeocodingToken(this.secrets, this.config);
    if (!token) return [];
    const cc = normalizeCountryCode(args.countryCode).toLowerCase();
    const params = new URLSearchParams({
      q: args.query.trim(),
      access_token: token,
      limit: String(args.limit ?? 5),
      language: 'fr',
      autocomplete: args.autocomplete ? 'true' : 'false',
      country: cc,
      types: 'address,place,locality,neighborhood,district,postcode',
    });
    const bbox = countryMapboxBboxParam(args.countryCode);
    if (bbox) params.set('bbox', bbox);
    const prox = this.formatProximity(
      args.proximityLng,
      args.proximityLat,
      args.countryCode,
    );
    params.set('proximity', prox);
    const url = `${resolveMapboxGeocodeApiUrl(this.config)}?${params}`;
    const { data } = await axios.get(url, { timeout: 14_000 });
    const features = Array.isArray(data?.features)
      ? data.features
      : Array.isArray(data?.results)
        ? data.results
        : [];
    return features
      .map((row: Record<string, unknown>) => mapboxV6ToFeature(row))
      .filter((row): row is GeocodeFeature => row != null);
  }

  private async fetchReverse(
    engine: GeocodeEngine,
    lat: number,
    lng: number,
  ): Promise<GeocodeFeature | null> {
    if (engine === 'mapbox') {
      const token = await resolveMapboxGeocodingToken(
        this.secrets,
        this.config,
      );
      if (!token) return null;
      const url =
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
        `?access_token=${encodeURIComponent(token)}&limit=1&language=fr`;
      const { data } = await axios.get(url, { timeout: 14_000 });
      const first = data?.features?.[0];
      if (!first) return null;
      return mapboxV6ToFeature(first as Record<string, unknown>);
    }
    if (engine === 'mapsco') {
      const apiKey = await resolveMapsCoGeocodingApiKey(
        this.secrets,
        this.config,
      );
      if (!apiKey) return null;
      const row = await mapsCoReverseGeocode(lat, lng, apiKey, this.config);
      if (!row) return null;
      return nominatimToFeature({
        lat: row.latitude,
        lon: row.longitude,
        display_name: row.address,
        address: {
          road: row.address,
          postcode: row.zipCode,
          city: row.city,
          country: row.country,
          country_code: row.countryCode.toLowerCase(),
        },
      });
    }
    if (engine === 'locationiq') {
      const accessToken = await resolveLocationIqAccessToken(
        this.secrets,
        this.config,
      );
      if (!accessToken) return null;
      const row = await locationIqReverseGeocode(
        lat,
        lng,
        accessToken,
        this.config,
      );
      if (!row) return null;
      return nominatimToFeature({
        lat: row.latitude,
        lon: row.longitude,
        display_name: row.address,
        address: {
          road: row.address,
          postcode: row.zipCode,
          city: row.city,
          country: row.country,
          country_code: row.countryCode.toLowerCase(),
        },
      });
    }
    if (engine === 'tomtom') {
      const apiKey = await resolveTomTomGeocodingApiKey(
        this.secrets,
        this.config,
      );
      if (!apiKey) return null;
      const row = await tomtomReverseGeocode(lat, lng, apiKey, this.config);
      if (!row) return null;
      return nominatimToFeature({
        lat: row.latitude,
        lon: row.longitude,
        display_name: row.address,
        address: {
          road: row.address,
          postcode: row.zipCode,
          city: row.city,
          country: row.country,
          country_code: row.countryCode.toLowerCase(),
        },
      });
    }
    const row = await osmReverseGeocode(lat, lng, this.config);
    if (!row) return null;
    return nominatimToFeature({
      lat: row.latitude,
      lon: row.longitude,
      display_name: row.address,
      address: {
        road: row.address,
        postcode: row.zipCode,
        city: row.city,
        country: row.country,
        country_code: row.countryCode.toLowerCase(),
      },
    });
  }

  private async fetchStructured(
    engine: GeocodeEngine,
    args: StructuredArgs,
  ): Promise<Record<string, unknown>> {
    if (engine === 'mapbox') {
      return this.fetchStructuredMapbox(args);
    }
    const item =
      engine === 'mapsco'
        ? await mapsCoSearchStructuredAddress(
            args,
            await resolveMapsCoGeocodingApiKey(this.secrets, this.config),
            this.config,
          )
        : engine === 'locationiq'
          ? await locationIqSearchStructuredAddress(
              args,
              await resolveLocationIqAccessToken(this.secrets, this.config),
              this.config,
            )
          : engine === 'tomtom'
            ? await tomtomSearchStructuredAddress(
                args,
                await resolveTomTomGeocodingApiKey(this.secrets, this.config),
                this.config,
              )
            : await osmSearchStructuredAddress(args, this.config);
    if (!item) {
      throw new NotFoundException('address_not_found');
    }
    if (
      args.zipCode?.trim() &&
      item.zipCode?.trim() &&
      normalizePostalCode(item.zipCode) !== normalizePostalCode(args.zipCode)
    ) {
      throw new NotFoundException('invalid_zip_code');
    }
    const location: [number, number] = [item.longitude, item.latitude];
    return {
      address:
        item.address ||
        `${args.address}, ${args.zipCode}, ${args.city}, ${args.country}`,
      country: item.country || args.country,
      countryCode: item.countryCode || args.countryCode || '',
      zipCode: item.zipCode || args.zipCode,
      city: item.city || args.city,
      location,
      feature: structuredSearchToFeature({
        ...args,
        location,
      }),
    };
  }

  private async fetchStructuredMapbox(args: StructuredArgs) {
    const token = await resolveMapboxGeocodingToken(this.secrets, this.config);
    if (!token) {
      return this.fetchStructured('osm', args);
    }
    const q = encodeURIComponent(
      `${args.address}, ${args.zipCode}, ${args.city}, ${args.country}`,
    );
    const cc = normalizeCountryCode(args.countryCode).toLowerCase();
    const url =
      `${resolveMapboxGeocodeApiUrl(this.config)}?q=${q}` +
      `&types=address&country=${cc}` +
      `&access_token=${encodeURIComponent(token)}` +
      `&limit=1&autocomplete=false&language=fr`;
    const { data } = await axios.get(url, { timeout: 14_000 });
    const features = Array.isArray(data?.features)
      ? data.features
      : Array.isArray(data?.results)
        ? data.results
        : [];
    if (!features.length) {
      throw new NotFoundException('address_not_found');
    }
    const formatPostalcode = normalizePostalCode;
    const item =
      features.find(
        (add: Record<string, unknown>) => {
          const props = (add.properties ?? {}) as Record<string, unknown>;
          const ctx = (props.context ?? {}) as Record<string, unknown>;
          const postcode = ctx.postcode as Record<string, unknown> | undefined;
          return (
            formatPostalcode(String(postcode?.name ?? '')) ===
            formatPostalcode(args.zipCode)
          );
        },
      ) ?? features[0];
    const feature = mapboxV6ToFeature(item as Record<string, unknown>);
    const props = (item.properties ?? item) as Record<string, unknown>;
    const ctx = (props.context ?? {}) as Record<string, unknown>;
    const postcode = ctx.postcode as Record<string, unknown> | undefined;
    if (
      formatPostalcode(String(postcode?.name ?? '')) !==
      formatPostalcode(args.zipCode)
    ) {
      throw new NotFoundException('invalid_zip_code');
    }
    const coords =
      feature?.center ??
      (Array.isArray(item.geometry?.coordinates)
        ? (item.geometry.coordinates as [number, number])
        : ([0, 0] as [number, number]));
    return {
      address:
        String(props.full_address ?? props.name ?? feature?.place_name ?? '') ||
        `${args.address}, ${args.zipCode}, ${args.city}, ${args.country}`,
      country: args.country,
      countryCode:
        String(
          (ctx.country as Record<string, unknown> | undefined)?.country_code ??
            args.countryCode,
        ) || args.countryCode,
      zipCode: args.zipCode,
      city: args.city,
      location: coords,
      feature,
    };
  }
}
