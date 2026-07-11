import { GEOCODE_MIN_QUERY_LENGTH } from '@common/normalize-geocode-query.util';
import type { OsmGeocodeResult } from '@common/osm-geocoding.util';
import { resolveGoogleMapsApiKey } from '@common/google-maps-api-key.util';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const REQUEST_TIMEOUT_MS = 14_000;

export { resolveGoogleMapsApiKey };

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: GoogleAddressComponent[];
};

function pickComponent(
  components: GoogleAddressComponent[] | undefined,
  type: string,
  useShort = false,
): string {
  if (!components) return '';
  for (const c of components) {
    if (c.types?.includes(type)) {
      return (useShort ? c.short_name : c.long_name)?.trim() ?? '';
    }
  }
  return '';
}

function parseGoogleResult(
  item: GoogleGeocodeResult,
): OsmGeocodeResult | null {
  const lat = Number(item.geometry?.location?.lat);
  const lon = Number(item.geometry?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const components = item.address_components;
  const streetNumber = pickComponent(components, 'street_number');
  const route = pickComponent(components, 'route');
  const line = [streetNumber, route].filter(Boolean).join(' ').trim();
  const city =
    pickComponent(components, 'locality') ||
    pickComponent(components, 'postal_town') ||
    pickComponent(components, 'administrative_area_level_2');
  const zipCode = pickComponent(components, 'postal_code');
  const country = pickComponent(components, 'country');
  const countryCode = pickComponent(components, 'country', true).toUpperCase();
  const freeform = String(item.formatted_address ?? '').trim();
  return {
    address: line || freeform,
    country,
    countryCode,
    city,
    zipCode,
    latitude: lat,
    longitude: lon,
  };
}

async function googleGeocodeGet(
  params: Record<string, string>,
): Promise<GoogleGeocodeResult[]> {
  try {
    const { status, data } = await axios.get<{
      status?: string;
      results?: GoogleGeocodeResult[];
    }>('https://maps.googleapis.com/maps/api/geocode/json', {
      params,
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (status !== 200) return [];
    if (data?.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return [];
    }
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

export async function googleForwardGeocode(
  query: string,
  apiKey: string,
  options?: { limit?: number; countryCode?: string; language?: string },
): Promise<OsmGeocodeResult[]> {
  const q = query.trim();
  if (!apiKey || q.length < GEOCODE_MIN_QUERY_LENGTH) return [];
  const params: Record<string, string> = {
    address: q,
    key: apiKey,
    language: options?.language ?? 'fr',
  };
  const cc = options?.countryCode?.trim().toUpperCase();
  if (cc) params.components = `country:${cc}`;
  const results = await googleGeocodeGet(params);
  const limit = options?.limit ?? 5;
  return results
    .slice(0, limit)
    .map((row) => parseGoogleResult(row))
    .filter((row): row is OsmGeocodeResult => row != null);
}

export async function googleReverseGeocode(
  lat: number,
  lng: number,
  apiKey: string,
  options?: { language?: string },
): Promise<OsmGeocodeResult | null> {
  if (!apiKey || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const results = await googleGeocodeGet({
    latlng: `${lat},${lng}`,
    key: apiKey,
    language: options?.language ?? 'fr',
  });
  const first = results[0];
  return first ? parseGoogleResult(first) : null;
}

export async function googleSearchStructuredAddress(
  args: {
    address: string;
    zipCode?: string;
    city?: string;
    country?: string;
    countryCode?: string;
  },
  apiKey: string,
): Promise<OsmGeocodeResult | null> {
  if (!apiKey) return null;
  const parts = [
    args.address,
    args.zipCode,
    args.city,
    args.country,
  ]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const rows = await googleForwardGeocode(parts.join(', '), apiKey, {
    limit: 1,
    countryCode: args.countryCode,
  });
  return rows[0] ?? null;
}

/** Résolution clé pour géocodage / routing (secret manager + env). */
export async function resolveGoogleGeocodingApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  return resolveGoogleMapsApiKey(secrets, config);
}
