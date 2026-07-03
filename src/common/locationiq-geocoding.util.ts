import { GEOCODE_MIN_QUERY_LENGTH } from '@common/normalize-geocode-query.util';
import {
  OsmGeocodeResult,
  parseNominatimItem,
} from '@common/osm-geocoding.util';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const DEFAULT_BASE = 'https://us1.locationiq.com/v1';
const REQUEST_TIMEOUT_MS = 14_000;
const RATE_LIMIT_RETRY_DELAY_MS = 1_100;

function locationIqBase(config?: ConfigService): string {
  const raw =
    config?.get<string>('LOCATIONIQ_GEOCODING_BASE_URL')?.trim() ||
    process.env.LOCATIONIQ_GEOCODING_BASE_URL?.trim() ||
    DEFAULT_BASE;
  return raw.replace(/\/+$/, '');
}

export async function resolveLocationIqAccessToken(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString(
    'api',
    'LOCATIONIQ_ACCESS_TOKEN',
  );
  const fromEnv = String(
    config?.get<string>('LOCATIONIQ_ACCESS_TOKEN') ??
      process.env.LOCATIONIQ_ACCESS_TOKEN ??
      '',
  ).trim();
  return fromDb.trim() || fromEnv;
}

async function locationIqGet<T>(
  url: string,
  params: Record<string, string>,
  accessToken: string,
  retryOn429 = true,
): Promise<T | null> {
  try {
    const { status, data } = await axios.get<T>(url, {
      params: { ...params, key: accessToken },
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (status === 429 && retryOn429) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS),
      );
      return locationIqGet(url, params, accessToken, false);
    }
    if (status !== 200) return null;
    return data;
  } catch {
    return null;
  }
}

/** Recherche d’adresse via LocationIQ (Nominatim compatible, quota). */
export async function locationIqForwardGeocode(
  query: string,
  accessToken: string,
  config?: ConfigService,
  options?: { limit?: number; countryCode?: string },
): Promise<OsmGeocodeResult[]> {
  const q = query.trim();
  if (!accessToken || q.length < GEOCODE_MIN_QUERY_LENGTH) return [];
  const base = locationIqBase(config);
  const params: Record<string, string> = {
    q,
    format: 'json',
    addressdetails: '1',
    limit: String(options?.limit ?? 6),
    'accept-language': 'fr,en',
  };
  const cc = options?.countryCode?.trim().toUpperCase();
  if (cc) params.countrycodes = cc.toLowerCase();
  const data = await locationIqGet<Record<string, unknown>[]>(
    `${base}/search`,
    params,
    accessToken,
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => parseNominatimItem(row))
    .filter((row): row is OsmGeocodeResult => row != null);
}

/** Géocodage inverse LocationIQ. */
export async function locationIqReverseGeocode(
  latitude: number,
  longitude: number,
  accessToken: string,
  config?: ConfigService,
): Promise<OsmGeocodeResult | null> {
  if (!accessToken) return null;
  const base = locationIqBase(config);
  const data = await locationIqGet<Record<string, unknown>>(
    `${base}/reverse`,
    {
      lat: String(latitude),
      lon: String(longitude),
      format: 'json',
      addressdetails: '1',
      'accept-language': 'fr,en',
    },
    accessToken,
  );
  if (!data || typeof data !== 'object') return null;
  return parseNominatimItem(data);
}

/** Valide une adresse structurée via LocationIQ. */
export async function locationIqSearchStructuredAddress(
  args: {
    address: string;
    city: string;
    country: string;
    zipCode: string;
    countryCode?: string;
  },
  accessToken: string,
  config?: ConfigService,
): Promise<OsmGeocodeResult | null> {
  const q = [args.address, args.city, args.country, args.zipCode]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(', ');
  const results = await locationIqForwardGeocode(q, accessToken, config, {
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
