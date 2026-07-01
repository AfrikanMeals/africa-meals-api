import {
  GeocodingEngineId,
  GeocodingEnginePoolEntry,
  normalizeGeocodingEnginePool,
  pickWeightedGeocodingEngine,
  resolveGeocodingPool,
} from '@common/geocoding-engine-pool.util';
import { normalizeRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import { MapSettingsModel } from '@schemas/map-settings.schema';

export type RegionMapSettingsOverride = Partial<{
  vendorMapboxEnabled: boolean;
  vendorGoogleEnabled: boolean;
  vendorOsmEnabled: boolean;
  vendorDefaultMapEngine: string;
  vendorGeocodingEngine: string;
  vendorGeocodingEnginePool: GeocodingEnginePoolEntry[];
  mobileUserMapboxEnabled: boolean;
  mobileUserGoogleEnabled: boolean;
  mobileUserOsmEnabled: boolean;
  mobileUserDefaultMapEngine: string;
  mobileUserGeocodingEngine: string;
  mobileUserGeocodingEnginePool: GeocodingEnginePoolEntry[];
  mobileDeliveryMapboxEnabled: boolean;
  mobileDeliveryGoogleEnabled: boolean;
  mobileDeliveryOsmEnabled: boolean;
  mobileDeliveryDefaultMapEngine: string;
  mobileDeliveryGeocodingEngine: string;
  mobileDeliveryGeocodingEnginePool: GeocodingEnginePoolEntry[];
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
  return flags.osm;
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

export function normalizeStoredGeocodingEnginePool(
  raw: unknown,
): GeocodingEnginePoolEntry[] {
  return normalizeGeocodingEnginePool(raw);
}
