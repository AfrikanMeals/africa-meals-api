import {
  GeocodingEngineId,
  GeocodingEnginePoolEntry,
  normalizeGeocodingEnginePool,
  pickWeightedGeocodingEngine,
  resolveGeocodingPool,
} from '@common/geocoding-engine-pool.util';
import {
  RoutingEngineId,
  RoutingEnginePoolEntry,
  normalizeRoutingEngineId,
  normalizeRoutingEnginePool,
  pickPrimaryRoutingEngine,
  pickWeightedRoutingEngine,
  resolveRoutingPool,
} from '@common/routing-engine-pool.util';
import { normalizeRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import { MapSettingsModel } from '@schemas/map-settings.schema';

export type RegionMapSettingsOverride = Partial<{
  vendorMapboxEnabled: boolean;
  vendorGoogleEnabled: boolean;
  vendorOsmEnabled: boolean;
  vendorDefaultMapEngine: string;
  vendorGeocodingEngine: string;
  vendorGeocodingEnginePool: GeocodingEnginePoolEntry[];
  vendorRoutingEngine: string;
  vendorRoutingEnginePool: RoutingEnginePoolEntry[];
  mobileUserMapboxEnabled: boolean;
  mobileUserGoogleEnabled: boolean;
  mobileUserOsmEnabled: boolean;
  mobileUserDefaultMapEngine: string;
  mobileUserGeocodingEngine: string;
  mobileUserGeocodingEnginePool: GeocodingEnginePoolEntry[];
  mobileUserRoutingEngine: string;
  mobileUserRoutingEnginePool: RoutingEnginePoolEntry[];
  mobileDeliveryMapboxEnabled: boolean;
  mobileDeliveryGoogleEnabled: boolean;
  mobileDeliveryOsmEnabled: boolean;
  mobileDeliveryDefaultMapEngine: string;
  mobileDeliveryGeocodingEngine: string;
  mobileDeliveryGeocodingEnginePool: GeocodingEnginePoolEntry[];
  mobileDeliveryRoutingEngine: string;
  mobileDeliveryRoutingEnginePool: RoutingEnginePoolEntry[];
}>;

export function readMapSettingsByRegion(
  doc: MapSettingsModel,
): Record<string, RegionMapSettingsOverride> {
  const raw = (doc as unknown as { settingsByRegion?: unknown })
    .settingsByRegion;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, RegionMapSettingsOverride> = {};
  for (const [key, value] of Object.entries(raw)) {
    const code = normalizeRegionCode(key);
    if (!code || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    out[code] = value as RegionMapSettingsOverride;
  }
  return out;
}

export function resolveMapSettingsForRegion(
  doc: MapSettingsModel,
  regionCode?: string | null,
): MapSettingsModel {
  const code = normalizeRegionCode(regionCode);
  if (!code) return doc;
  const override = readMapSettingsByRegion(doc)[code];
  if (!override) return doc;
  return {
    ...doc,
    ...override,
  };
}

export type MapSettingsGroupKey = 'vendor' | 'mobileUser' | 'mobileDelivery';

export function geocodingEngineForGroup(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
): GeocodingEngineId {
  const raw =
    group === 'vendor'
      ? doc.vendorGeocodingEngine
      : group === 'mobileDelivery'
        ? doc.mobileDeliveryGeocodingEngine
        : doc.mobileUserGeocodingEngine;
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
  if (v === 'pelias') return 'pelias';
  return 'osm';
}

export function geocodingEnginePoolForGroup(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
): GeocodingEnginePoolEntry[] {
  const raw =
    group === 'vendor'
      ? doc.vendorGeocodingEnginePool
      : group === 'mobileDelivery'
        ? doc.mobileDeliveryGeocodingEnginePool
        : doc.mobileUserGeocodingEnginePool;
  return resolveGeocodingPool(raw, geocodingEngineForGroup(doc, group));
}

export function routingEngineForGroup(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
): RoutingEngineId {
  const raw =
    group === 'vendor'
      ? doc.vendorRoutingEngine
      : group === 'mobileDelivery'
        ? doc.mobileDeliveryRoutingEngine
        : doc.mobileUserRoutingEngine;
  return normalizeRoutingEngineId(raw) ?? 'osrm';
}

export function routingEnginePoolForGroup(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
): RoutingEnginePoolEntry[] {
  const raw =
    group === 'vendor'
      ? doc.vendorRoutingEnginePool
      : group === 'mobileDelivery'
        ? doc.mobileDeliveryRoutingEnginePool
        : doc.mobileUserRoutingEnginePool;
  return resolveRoutingPool(raw, routingEngineForGroup(doc, group), {
    foodDelivery: group === 'mobileDelivery',
  });
}

export function isEngineEnabledForGroup(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
  engine: GeocodingEngineId,
): boolean {
  const flags =
    group === 'vendor'
      ? {
          mapbox: doc.vendorMapboxEnabled !== false,
          google: doc.vendorGoogleEnabled !== false,
          osm: doc.vendorOsmEnabled !== false,
        }
      : group === 'mobileDelivery'
        ? {
            mapbox: doc.mobileDeliveryMapboxEnabled !== false,
            google: doc.mobileDeliveryGoogleEnabled !== false,
            osm: doc.mobileDeliveryOsmEnabled !== false,
          }
        : {
            mapbox: doc.mobileUserMapboxEnabled !== false,
            google: doc.mobileUserGoogleEnabled !== false,
            osm: doc.mobileUserOsmEnabled !== false,
          };
  if (engine === 'mapbox') return flags.mapbox;
  if (engine === 'google') return flags.google;
  if (engine === 'mapsco') return true;
  if (engine === 'locationiq') return true;
  if (engine === 'tomtom') return true;
  if (engine === 'pelias') return true;
  return flags.osm;
}

/** Éligibilité routing : OSRM toujours ; mapbox/google liés aux flags display. */
export function isRoutingEngineEnabledForGroup(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
  engine: RoutingEngineId,
): boolean {
  const flags =
    group === 'vendor'
      ? {
          mapbox: doc.vendorMapboxEnabled !== false,
          google: doc.vendorGoogleEnabled !== false,
        }
      : group === 'mobileDelivery'
        ? {
            mapbox: doc.mobileDeliveryMapboxEnabled !== false,
            google: doc.mobileDeliveryGoogleEnabled !== false,
          }
        : {
            mapbox: doc.mobileUserMapboxEnabled !== false,
            google: doc.mobileUserGoogleEnabled !== false,
          };
  if (engine === 'osrm' || engine === 'valhalla') return true;
  if (engine === 'mapbox') return flags.mapbox;
  if (engine === 'google_routes' || engine === 'google_directions') {
    return flags.google;
  }
  if (engine === 'here' || engine === 'tomtom') return true;
  return true;
}

export function resolveGeocodingEngineForRegion(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
  regionCode?: string | null,
  random: () => number = Math.random,
): GeocodingEngineId {
  const merged = resolveMapSettingsForRegion(doc, regionCode);
  const fallback = geocodingEngineForGroup(merged, group);
  const pool = geocodingEnginePoolForGroup(merged, group);
  return pickWeightedGeocodingEngine(
    pool,
    (engine) => isEngineEnabledForGroup(merged, group, engine),
    fallback,
    random,
  );
}

export function resolveRoutingEngineForRegion(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
  regionCode?: string | null,
  random: () => number = Math.random,
): RoutingEngineId {
  const merged = resolveMapSettingsForRegion(doc, regionCode);
  const fallback = routingEngineForGroup(merged, group);
  const pool = routingEnginePoolForGroup(merged, group);
  const isEligible = (engine: RoutingEngineId) =>
    isRoutingEngineEnabledForGroup(merged, group, engine);
  // Livraison repas : OSRM-first déterministe (ETA stables, coût bas).
  if (group === 'mobileDelivery') {
    return pickPrimaryRoutingEngine(pool, isEligible, fallback);
  }
  return pickWeightedRoutingEngine(pool, isEligible, fallback, random);
}

export function normalizeStoredGeocodingEnginePool(
  raw: unknown,
): GeocodingEnginePoolEntry[] {
  return normalizeGeocodingEnginePool(raw);
}

export function normalizeStoredRoutingEnginePool(
  raw: unknown,
): RoutingEnginePoolEntry[] {
  return normalizeRoutingEnginePool(raw);
}
