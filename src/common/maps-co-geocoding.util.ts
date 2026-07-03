import { GEOCODE_MIN_QUERY_LENGTH } from '@common/normalize-geocode-query.util';
import {
  OsmGeocodeResult,
  parseNominatimItem,
} from '@common/osm-geocoding.util';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const DEFAULT_BASE = 'https://geocode.maps.co';
const REQUEST_TIMEOUT_MS = 14_000;
const RATE_LIMIT_RETRY_DELAY_MS = 1_100;

function mapsCoBase(config?: ConfigService): string {
  const raw =
    config?.get<string>('MAPS_CO_GEOCODING_BASE_URL')?.trim() ||
    process.env.MAPS_CO_GEOCODING_BASE_URL?.trim() ||
    DEFAULT_BASE;
  return raw.replace(/\/+$/, '');
}

export async function resolveMapsCoGeocodingApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString('api', 'MAPS_CO_GEOCODING_API_KEY');
  const fromEnv = String(
    config?.get<string>('MAPS_CO_GEOCODING_API_KEY') ??
      process.env.MAPS_CO_GEOCODING_API_KEY ??
      '',
  ).trim();
  return fromDb.trim() || fromEnv;
}

async function mapsCoGet<T>(
  url: string,
  params: Record<string, string>,
  apiKey: string,
  retryOn429 = true,
): Promise<T | null> {
  try {
    const { status, data } = await axios.get<T>(url, {
      params: { ...params, api_key: apiKey },
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (status === 429 && retryOn429) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS),
      );
      return mapsCoGet(url, params, apiKey, false);
    }
    if (status !== 200) return null;
    return data;
  } catch {
    return null;
  }
}

/** Recherche d’adresse via Maps.co (Nominatim hébergé, facturé au quota). */
export async function mapsCoForwardGeocode(
  query: string,
  apiKey: string,
  config?: ConfigService,
  options?: { limit?: number; countryCode?: string },
): Promise<OsmGeocodeResult[]> {
  const q = query.trim();
  if (!apiKey || q.length < GEOCODE_MIN_QUERY_LENGTH) return [];
  const base = mapsCoBase(config);
  const params: Record<string, string> = {
    q,
    format: 'json',
    addressdetails: '1',
    limit: String(options?.limit ?? 6),
  };
  const cc = options?.countryCode?.trim().toUpperCase();
  if (cc) params.countrycodes = cc.toLowerCase();
  const data = await mapsCoGet<Record<string, unknown>[]>(
    `${base}/search`,
    params,
    apiKey,
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => parseNominatimItem(row))
    .filter((row): row is OsmGeocodeResult => row != null);
}

/** Géocodage inverse Maps.co. */
export async function mapsCoReverseGeocode(
  latitude: number,
  longitude: number,
  apiKey: string,
  config?: ConfigService,
): Promise<OsmGeocodeResult | null> {
  if (!apiKey) return null;
  const base = mapsCoBase(config);
  const data = await mapsCoGet<Record<string, unknown>>(
    `${base}/reverse`,
    {
      lat: String(latitude),
      lon: String(longitude),
      format: 'json',
      addressdetails: '1',
    },
    apiKey,
  );
  if (!data || typeof data !== 'object') return null;
  return parseNominatimItem(data);
}

/** Valide une adresse structurée via Maps.co. */
export async function mapsCoSearchStructuredAddress(
  args: {
    address: string;
    city: string;
    country: string;
    zipCode: string;
    countryCode?: string;
  },
  apiKey: string,
  config?: ConfigService,
): Promise<OsmGeocodeResult | null> {
  const q = [args.address, args.city, args.country, args.zipCode]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(', ');
  const results = await mapsCoForwardGeocode(q, apiKey, config, {
    limit: 5,
    countryCode: args.countryCode,
  });
  if (!results.length) return null;
  const zipNorm = String(args.zipCode ?? '')
    .replace(/\s+/g, '')
    .toLowerCase();
  if (zipNorm) {
    const match = results.find(
      (r) =>
        r.zipCode.replace(/\s+/g, '').toLowerCase() === zipNorm ||
        r.zipCode.replace(/\s+/g, '').toLowerCase().startsWith(zipNorm),
    );
    if (match) return match;
  }
  return results[0] ?? null;
}
