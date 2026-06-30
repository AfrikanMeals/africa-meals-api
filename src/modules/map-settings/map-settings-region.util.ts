import { normalizeRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import { MapSettingsModel } from '@schemas/map-settings.schema';

export type RegionMapSettingsOverride = Partial<{
  vendorMapboxEnabled: boolean;
  vendorGoogleEnabled: boolean;
  vendorOsmEnabled: boolean;
  vendorDefaultMapEngine: string;
  vendorGeocodingEngine: string;
  mobileUserMapboxEnabled: boolean;
  mobileUserGoogleEnabled: boolean;
  mobileUserOsmEnabled: boolean;
  mobileUserDefaultMapEngine: string;
  mobileUserGeocodingEngine: string;
  mobileDeliveryMapboxEnabled: boolean;
  mobileDeliveryGoogleEnabled: boolean;
  mobileDeliveryOsmEnabled: boolean;
  mobileDeliveryDefaultMapEngine: string;
  mobileDeliveryGeocodingEngine: string;
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
): 'osm' | 'mapbox' | 'google' {
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

export function isEngineEnabledForGroup(
  doc: MapSettingsModel,
  group: MapSettingsGroupKey,
  engine: 'osm' | 'mapbox' | 'google',
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
): 'osm' | 'mapbox' | 'google' {
  const merged = resolveMapSettingsForRegion(doc, regionCode);
  let engine = geocodingEngineForGroup(merged, group);
  if (!isEngineEnabledForGroup(merged, group, engine)) {
    if (isEngineEnabledForGroup(merged, group, 'osm')) return 'osm';
    if (isEngineEnabledForGroup(merged, group, 'mapbox')) return 'mapbox';
    if (isEngineEnabledForGroup(merged, group, 'google')) return 'google';
    return 'osm';
  }
  return engine;
}
