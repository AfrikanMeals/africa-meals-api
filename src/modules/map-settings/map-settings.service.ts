import {
  resolveMapboxPublicAccessToken,
} from '@common/mapbox-geocoding.util';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import {
  assertGeocodeCacheStorePriority,
  DEFAULT_GEOCODE_CACHE_STORE_PRIORITY,
  GeocodeCacheStore,
  normalizeGeocodeCacheStorePriority,
} from '@common/geocode-cache-store.util';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  MapSettingsDocument,
  MapSettingsModel,
} from '@schemas/map-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { normalizeRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import {
  GeocodingEnginePoolEntry,
  primaryGeocodingEngineFromPool,
} from '@common/geocoding-engine-pool.util';
import {
  RoutingEnginePoolEntry,
  normalizeRoutingEngineId,
  primaryRoutingEngineFromPool,
} from '@common/routing-engine-pool.util';
import {
  DEFAULT_ROUTING_CACHE_SETTINGS,
  normalizeRoutingCacheSettings,
} from '@common/routing-cache-settings.util';
import { UpdateMapSettingsDto } from './dto/update-map-settings.dto';
import {
  geocodingEnginePoolForGroup,
  normalizeStoredGeocodingEnginePool,
  normalizeStoredRoutingEnginePool,
  resolveMapSettingsForRegion,
  routingEnginePoolForGroup,
} from './map-settings-region.util';

const SETTINGS_KEY = 'default';

type VendorEngine = 'mapbox' | 'google' | 'osm';
type MobileEngine = 'mapbox' | 'google' | 'osm';
type GeocodingEngine = 'mapbox' | 'google' | 'osm' | 'mapsco' | 'locationiq' | 'tomtom';
type RoutingEngine =
  | 'osrm'
  | 'mapbox'
  | 'google_routes'
  | 'google_directions'
  | 'here'
  | 'tomtom';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function assertAtLeastOneEngine(
  mapbox: boolean,
  google: boolean,
  osm: boolean,
  scope: string,
) {
  if (!mapbox && !google && !osm) {
    throw new BadRequestException(`at_least_one_map_engine_required_${scope}`);
  }
}

function normalizeVendorDefault(raw: unknown): VendorEngine {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'google') return 'google';
  if (v === 'mapbox') return 'mapbox';
  return 'osm';
}

function normalizeMobileDefault(raw: unknown): MobileEngine {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'google') return 'google';
  if (v === 'mapbox') return 'mapbox';
  return 'osm';
}

function normalizeGeocodingEngine(raw: unknown): GeocodingEngine {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'google') return 'google';
  if (v === 'mapbox') return 'mapbox';
  if (v === 'mapsco' || v === 'maps.co' || v === 'maps_co') return 'mapsco';
  if (
    v === 'locationiq' ||
    v === 'location.iq' ||
    v === 'location_iq'
  ) {
    return 'locationiq';
  }
  if (v === 'tomtom') return 'tomtom';
  return 'osm';
}

function normalizeRoutingEngine(raw: unknown): RoutingEngine {
  return normalizeRoutingEngineId(raw) ?? 'osrm';
}

function poolForResponse(
  doc: MapSettingsModel,
  group: 'vendor' | 'mobileUser' | 'mobileDelivery',
): GeocodingEnginePoolEntry[] {
  return geocodingEnginePoolForGroup(doc, group);
}

function routingPoolForResponse(
  doc: MapSettingsModel,
  group: 'vendor' | 'mobileUser' | 'mobileDelivery',
): RoutingEnginePoolEntry[] {
  return routingEnginePoolForGroup(doc, group);
}

function assertDefaultEngineEnabled(
  engine: string,
  mapbox: boolean,
  google: boolean,
  osm: boolean,
  scope: string,
) {
  const normalized = String(engine ?? '').trim().toLowerCase();
  const enabled =
    (normalized === 'mapbox' && mapbox) ||
    (normalized === 'google' && google) ||
    (normalized === 'osm' && osm);
  if (!enabled) {
    throw new BadRequestException(`default_map_engine_not_enabled_${scope}`);
  }
}

@Injectable()
export class MapSettingsService {
  constructor(
    @InjectModel(MapSettingsModel.name)
    private readonly _settings: Model<MapSettingsDocument>,
    private readonly _moduleCache: ModuleCacheLayerService,
    private readonly _secrets: SecretManagerService,
    private readonly _config: ConfigService,
  ) {}

  private _geocodeCacheAvailability(): Record<GeocodeCacheStore, boolean> {
    const availability = this._moduleCache.getAvailability();
    return {
      redis: availability.redis,
      memcached: availability.memcached,
      mongodb: true,
    };
  }

  private _toResponse(doc: MapSettingsModel, regionCode?: string | null) {
    const scoped = resolveMapSettingsForRegion(doc, regionCode);
    const typed = doc as unknown as { updatedAt?: Date };
    const vendorDefault = normalizeVendorDefault(scoped.vendorDefaultMapEngine);
    const mobileUserDefault = normalizeMobileDefault(
      scoped.mobileUserDefaultMapEngine,
    );
    const mobileDeliveryDefault = normalizeMobileDefault(
      scoped.mobileDeliveryDefaultMapEngine,
    );
    const resolvedRegionCode = normalizeRegionCode(regionCode);
    return {
      vendor: {
        mapboxEnabled: scoped.vendorMapboxEnabled !== false,
        googleEnabled: scoped.vendorGoogleEnabled !== false,
        osmEnabled: scoped.vendorOsmEnabled !== false,
        defaultMapEngine: vendorDefault,
        geocodingEngine: normalizeGeocodingEngine(scoped.vendorGeocodingEngine),
        geocodingEnginePool: poolForResponse(scoped, 'vendor'),
        routingEngine: normalizeRoutingEngine(scoped.vendorRoutingEngine),
        routingEnginePool: routingPoolForResponse(scoped, 'vendor'),
      },
      mobileUser: {
        mapboxEnabled: scoped.mobileUserMapboxEnabled !== false,
        googleEnabled: scoped.mobileUserGoogleEnabled !== false,
        osmEnabled: scoped.mobileUserOsmEnabled !== false,
        defaultMapEngine: mobileUserDefault,
        geocodingEngine: normalizeGeocodingEngine(
          scoped.mobileUserGeocodingEngine,
        ),
        geocodingEnginePool: poolForResponse(scoped, 'mobileUser'),
        routingEngine: normalizeRoutingEngine(scoped.mobileUserRoutingEngine),
        routingEnginePool: routingPoolForResponse(scoped, 'mobileUser'),
      },
      mobileDelivery: {
        mapboxEnabled: scoped.mobileDeliveryMapboxEnabled !== false,
        googleEnabled: scoped.mobileDeliveryGoogleEnabled !== false,
        osmEnabled: scoped.mobileDeliveryOsmEnabled !== false,
        defaultMapEngine: mobileDeliveryDefault,
        geocodingEngine: normalizeGeocodingEngine(
          scoped.mobileDeliveryGeocodingEngine,
        ),
        geocodingEnginePool: poolForResponse(scoped, 'mobileDelivery'),
        routingEngine: normalizeRoutingEngine(
          scoped.mobileDeliveryRoutingEngine,
        ),
        routingEnginePool: routingPoolForResponse(scoped, 'mobileDelivery'),
      },
      resolvedRegionCode,
      geocodeCache: {
        storePriority: normalizeGeocodeCacheStorePriority(
          doc.geocodeCacheStorePriority,
        ),
        storeAvailability: this._geocodeCacheAvailability(),
      },
      routingCache: normalizeRoutingCacheSettings(doc.routingCache),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getSettingsDocument(): Promise<MapSettingsModel> {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            vendorMapboxEnabled: true,
            vendorGoogleEnabled: false,
            vendorOsmEnabled: true,
            vendorDefaultMapEngine: 'osm',
            mobileUserMapboxEnabled: true,
            mobileUserGoogleEnabled: true,
            mobileUserOsmEnabled: true,
            mobileUserDefaultMapEngine: 'osm',
            mobileDeliveryMapboxEnabled: true,
            mobileDeliveryGoogleEnabled: true,
            mobileDeliveryOsmEnabled: true,
            mobileDeliveryDefaultMapEngine: 'osm',
            vendorGeocodingEngine: 'osm',
            mobileUserGeocodingEngine: 'osm',
            mobileDeliveryGeocodingEngine: 'osm',
            vendorGeocodingEnginePool: [],
            mobileUserGeocodingEnginePool: [],
            mobileDeliveryGeocodingEnginePool: [],
            vendorRoutingEngine: 'osrm',
            mobileUserRoutingEngine: 'osrm',
            mobileDeliveryRoutingEngine: 'osrm',
            vendorRoutingEnginePool: [],
            mobileUserRoutingEnginePool: [],
            mobileDeliveryRoutingEnginePool: [],
            geocodeCacheStorePriority: [...DEFAULT_GEOCODE_CACHE_STORE_PRIORITY],
            routingCache: { ...DEFAULT_ROUTING_CACHE_SETTINGS },
            settingsByRegion: {},
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as MapSettingsModel;
  }

  async getPublicSettings(regionCode?: string | null) {
    const doc = await this.getSettingsDocument();
    const base = this._toResponse(doc, regionCode);
    const mapboxPublicAccessToken = await resolveMapboxPublicAccessToken(
      this._secrets,
      this._config,
    );
    return {
      ...base,
      mapboxPublicAccessToken: mapboxPublicAccessToken || null,
    };
  }

  async updateSettings(user: UserModel, dto: UpdateMapSettingsDto) {
    assertAdmin(user);
    assertAtLeastOneEngine(
      dto.vendorMapboxEnabled,
      dto.vendorGoogleEnabled,
      dto.vendorOsmEnabled,
      'vendor',
    );
    assertAtLeastOneEngine(
      dto.mobileUserMapboxEnabled,
      dto.mobileUserGoogleEnabled,
      dto.mobileUserOsmEnabled,
      'mobile_user',
    );
    assertAtLeastOneEngine(
      dto.mobileDeliveryMapboxEnabled,
      dto.mobileDeliveryGoogleEnabled,
      dto.mobileDeliveryOsmEnabled,
      'mobile_delivery',
    );

    const existing = await this._settings
      .findOne({ key: SETTINGS_KEY })
      .lean()
      .exec();

    const vendorDefault = normalizeVendorDefault(
      dto.vendorDefaultMapEngine ??
        (existing as MapSettingsModel | null)?.vendorDefaultMapEngine,
    );
    const mobileUserDefault = normalizeMobileDefault(
      dto.mobileUserDefaultMapEngine ??
        (existing as MapSettingsModel | null)?.mobileUserDefaultMapEngine,
    );
    const mobileDeliveryDefault = normalizeMobileDefault(
      dto.mobileDeliveryDefaultMapEngine ??
        (existing as MapSettingsModel | null)?.mobileDeliveryDefaultMapEngine,
    );
    const vendorGeocoding = normalizeGeocodingEngine(
      dto.vendorGeocodingEngine ??
        (existing as MapSettingsModel | null)?.vendorGeocodingEngine,
    );
    const mobileUserGeocoding = normalizeGeocodingEngine(
      dto.mobileUserGeocodingEngine ??
        (existing as MapSettingsModel | null)?.mobileUserGeocodingEngine,
    );
    const mobileDeliveryGeocoding = normalizeGeocodingEngine(
      dto.mobileDeliveryGeocodingEngine ??
        (existing as MapSettingsModel | null)?.mobileDeliveryGeocodingEngine,
    );
    const vendorGeocodingPool =
      dto.vendorGeocodingEnginePool !== undefined
        ? normalizeStoredGeocodingEnginePool(dto.vendorGeocodingEnginePool)
        : normalizeStoredGeocodingEnginePool(
            (existing as MapSettingsModel | null)?.vendorGeocodingEnginePool,
          );
    const mobileUserGeocodingPool =
      dto.mobileUserGeocodingEnginePool !== undefined
        ? normalizeStoredGeocodingEnginePool(dto.mobileUserGeocodingEnginePool)
        : normalizeStoredGeocodingEnginePool(
            (existing as MapSettingsModel | null)?.mobileUserGeocodingEnginePool,
          );
    const mobileDeliveryGeocodingPool =
      dto.mobileDeliveryGeocodingEnginePool !== undefined
        ? normalizeStoredGeocodingEnginePool(
            dto.mobileDeliveryGeocodingEnginePool,
          )
        : normalizeStoredGeocodingEnginePool(
            (existing as MapSettingsModel | null)
              ?.mobileDeliveryGeocodingEnginePool,
          );

    const vendorRouting = normalizeRoutingEngine(
      dto.vendorRoutingEngine ??
        (existing as MapSettingsModel | null)?.vendorRoutingEngine,
    );
    const mobileUserRouting = normalizeRoutingEngine(
      dto.mobileUserRoutingEngine ??
        (existing as MapSettingsModel | null)?.mobileUserRoutingEngine,
    );
    const mobileDeliveryRouting = normalizeRoutingEngine(
      dto.mobileDeliveryRoutingEngine ??
        (existing as MapSettingsModel | null)?.mobileDeliveryRoutingEngine,
    );
    const vendorRoutingPool =
      dto.vendorRoutingEnginePool !== undefined
        ? normalizeStoredRoutingEnginePool(dto.vendorRoutingEnginePool)
        : normalizeStoredRoutingEnginePool(
            (existing as MapSettingsModel | null)?.vendorRoutingEnginePool,
          );
    const mobileUserRoutingPool =
      dto.mobileUserRoutingEnginePool !== undefined
        ? normalizeStoredRoutingEnginePool(dto.mobileUserRoutingEnginePool)
        : normalizeStoredRoutingEnginePool(
            (existing as MapSettingsModel | null)?.mobileUserRoutingEnginePool,
          );
    const mobileDeliveryRoutingPool =
      dto.mobileDeliveryRoutingEnginePool !== undefined
        ? normalizeStoredRoutingEnginePool(
            dto.mobileDeliveryRoutingEnginePool,
          )
        : normalizeStoredRoutingEnginePool(
            (existing as MapSettingsModel | null)
              ?.mobileDeliveryRoutingEnginePool,
          );

    const vendorGeocodingResolved = primaryGeocodingEngineFromPool(
      vendorGeocodingPool.length
        ? vendorGeocodingPool
        : [{ engine: vendorGeocoding, weight: 100 }],
      vendorGeocoding,
    );
    const mobileUserGeocodingResolved = primaryGeocodingEngineFromPool(
      mobileUserGeocodingPool.length
        ? mobileUserGeocodingPool
        : [{ engine: mobileUserGeocoding, weight: 100 }],
      mobileUserGeocoding,
    );
    const mobileDeliveryGeocodingResolved = primaryGeocodingEngineFromPool(
      mobileDeliveryGeocodingPool.length
        ? mobileDeliveryGeocodingPool
        : [{ engine: mobileDeliveryGeocoding, weight: 100 }],
      mobileDeliveryGeocoding,
    );
    const vendorRoutingResolved = primaryRoutingEngineFromPool(
      vendorRoutingPool.length
        ? vendorRoutingPool
        : [{ engine: vendorRouting, weight: 100 }],
      vendorRouting,
    );
    const mobileUserRoutingResolved = primaryRoutingEngineFromPool(
      mobileUserRoutingPool.length
        ? mobileUserRoutingPool
        : [{ engine: mobileUserRouting, weight: 100 }],
      mobileUserRouting,
    );
    const mobileDeliveryRoutingResolved = primaryRoutingEngineFromPool(
      mobileDeliveryRoutingPool.length
        ? mobileDeliveryRoutingPool
        : [{ engine: mobileDeliveryRouting, weight: 100 }],
      mobileDeliveryRouting,
    );
    let geocodeCacheStorePriority = normalizeGeocodeCacheStorePriority(
      (existing as MapSettingsModel | null)?.geocodeCacheStorePriority,
    );
    if (dto.geocodeCacheStorePriority !== undefined) {
      try {
        geocodeCacheStorePriority = assertGeocodeCacheStorePriority(
          dto.geocodeCacheStorePriority,
        );
      } catch {
        throw new BadRequestException('geocode_cache_store_priority_invalid');
      }
    }

    const routingCache = normalizeRoutingCacheSettings({
      ...normalizeRoutingCacheSettings(
        (existing as MapSettingsModel | null)?.routingCache,
      ),
      ...(dto.routingCache ?? {}),
    });

    assertDefaultEngineEnabled(
      vendorDefault,
      dto.vendorMapboxEnabled,
      dto.vendorGoogleEnabled,
      dto.vendorOsmEnabled,
      'vendor',
    );
    assertDefaultEngineEnabled(
      mobileUserDefault,
      dto.mobileUserMapboxEnabled,
      dto.mobileUserGoogleEnabled,
      dto.mobileUserOsmEnabled,
      'mobile_user',
    );
    assertDefaultEngineEnabled(
      mobileDeliveryDefault,
      dto.mobileDeliveryMapboxEnabled,
      dto.mobileDeliveryGoogleEnabled,
      dto.mobileDeliveryOsmEnabled,
      'mobile_delivery',
    );

    const assertPoolHasWeight = (
      pool: Array<{ weight: number }>,
      scope: string,
      kind: 'geocoding' | 'routing' = 'geocoding',
    ) => {
      if (!pool.length) return;
      const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
      if (total <= 0) {
        throw new BadRequestException(`${kind}_engine_pool_empty_${scope}`);
      }
    };
    if (dto.vendorGeocodingEnginePool !== undefined) {
      assertPoolHasWeight(vendorGeocodingPool, 'vendor');
    }
    if (dto.mobileUserGeocodingEnginePool !== undefined) {
      assertPoolHasWeight(mobileUserGeocodingPool, 'mobile_user');
    }
    if (dto.mobileDeliveryGeocodingEnginePool !== undefined) {
      assertPoolHasWeight(mobileDeliveryGeocodingPool, 'mobile_delivery');
    }
    if (dto.vendorRoutingEnginePool !== undefined) {
      assertPoolHasWeight(vendorRoutingPool, 'vendor', 'routing');
    }
    if (dto.mobileUserRoutingEnginePool !== undefined) {
      assertPoolHasWeight(mobileUserRoutingPool, 'mobile_user', 'routing');
    }
    if (dto.mobileDeliveryRoutingEnginePool !== undefined) {
      assertPoolHasWeight(
        mobileDeliveryRoutingPool,
        'mobile_delivery',
        'routing',
      );
    }

    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            vendorMapboxEnabled: dto.vendorMapboxEnabled,
            vendorGoogleEnabled: dto.vendorGoogleEnabled,
            vendorOsmEnabled: dto.vendorOsmEnabled,
            vendorDefaultMapEngine: vendorDefault,
            mobileUserMapboxEnabled: dto.mobileUserMapboxEnabled,
            mobileUserGoogleEnabled: dto.mobileUserGoogleEnabled,
            mobileUserOsmEnabled: dto.mobileUserOsmEnabled,
            mobileUserDefaultMapEngine: mobileUserDefault,
            mobileDeliveryMapboxEnabled: dto.mobileDeliveryMapboxEnabled,
            mobileDeliveryGoogleEnabled: dto.mobileDeliveryGoogleEnabled,
            mobileDeliveryOsmEnabled: dto.mobileDeliveryOsmEnabled,
            mobileDeliveryDefaultMapEngine: mobileDeliveryDefault,
            vendorGeocodingEngine: vendorGeocodingResolved,
            mobileUserGeocodingEngine: mobileUserGeocodingResolved,
            mobileDeliveryGeocodingEngine: mobileDeliveryGeocodingResolved,
            vendorGeocodingEnginePool: vendorGeocodingPool,
            mobileUserGeocodingEnginePool: mobileUserGeocodingPool,
            mobileDeliveryGeocodingEnginePool: mobileDeliveryGeocodingPool,
            vendorRoutingEngine: vendorRoutingResolved,
            mobileUserRoutingEngine: mobileUserRoutingResolved,
            mobileDeliveryRoutingEngine: mobileDeliveryRoutingResolved,
            vendorRoutingEnginePool: vendorRoutingPool,
            mobileUserRoutingEnginePool: mobileUserRoutingPool,
            mobileDeliveryRoutingEnginePool: mobileDeliveryRoutingPool,
            geocodeCacheStorePriority,
            routingCache,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
