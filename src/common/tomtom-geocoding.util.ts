import { GEOCODE_MIN_QUERY_LENGTH } from '@common/normalize-geocode-query.util';
import {
  OsmGeocodeResult,
} from '@common/osm-geocoding.util';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const DEFAULT_BASE = 'https://api.tomtom.com';
const SEARCH_VERSION = '2';
const REQUEST_TIMEOUT_MS = 14_000;
const RATE_LIMIT_RETRY_DELAY_MS = 1_100;

function tomtomBase(config?: ConfigService): string {
  const raw =
    config?.get<string>('TOMTOM_GEOCODING_BASE_URL')?.trim() ||
    process.env.TOMTOM_GEOCODING_BASE_URL?.trim() ||
    DEFAULT_BASE;
  return raw.replace(/\/+$/, '');
}

export async function resolveTomTomGeocodingApiKey(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString('api', 'TOMTOM_GEOCODING_API_KEY');
  const fromEnv = String(
    config?.get<string>('TOMTOM_GEOCODING_API_KEY') ??
      process.env.TOMTOM_GEOCODING_API_KEY ??
      '',
  ).trim();
  return fromDb.trim() || fromEnv;
}

function parseTomTomResult(
  item: Record<string, unknown>,
): OsmGeocodeResult | null {
  const pos = item.position as Record<string, unknown> | undefined;
  const lat = Number(pos?.lat);
  const lon = Number(pos?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const addr = item.address as Record<string, unknown> | undefined;
  const streetNumber = String(addr?.streetNumber ?? '').trim();
  const streetName = String(addr?.streetName ?? '').trim();
  const freeform = String(addr?.freeformAddress ?? '').trim();
  const line =
    [streetNumber, streetName].filter(Boolean).join(' ').trim() ||
    freeform.split(',')[0]?.trim() ||
    '';
  const city = String(
    addr?.municipality ??
      addr?.localName ??
      addr?.municipalitySubdivision ??
      '',
  ).trim();
  const zipCode = String(addr?.postalCode ?? '').trim();
  const country = String(addr?.country ?? '').trim();
  const countryCode = String(addr?.countryCode ?? '').toUpperCase();
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

type TomTomSearchResponse = {
  results?: Record<string, unknown>[];
};

async function tomtomGet<T>(
  url: string,
  params: Record<string, string>,
  retryOn429 = true,
): Promise<T | null> {
  try {
    const { status, data } = await axios.get<T>(url, {
      params,
      headers: { Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (status === 429 && retryOn429) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS),
      );
      return tomtomGet(url, params, false);
    }
    if (status !== 200) return null;
    return data;
  } catch {
    return null;
  }
}

/** Recherche d’adresse via TomTom Search API (Geocoding v2). */
export async function tomtomForwardGeocode(
  query: string,
  apiKey: string,
  config?: ConfigService,
  options?: {
    limit?: number;
    countryCode?: string;
    proximityLat?: number;
    proximityLng?: number;
  },
): Promise<OsmGeocodeResult[]> {
  const q = query.trim();
  if (!apiKey || q.length < GEOCODE_MIN_QUERY_LENGTH) return [];
  const base = tomtomBase(config);
  const encoded = encodeURIComponent(q);
  const params: Record<string, string> = {
    key: apiKey,
    limit: String(Math.min(options?.limit ?? 6, 20)),
    language: 'fr-FR',
  };
  const cc = options?.countryCode?.trim().toUpperCase();
  if (cc) params.countrySet = cc;
  if (
    Number.isFinite(options?.proximityLat) &&
    Number.isFinite(options?.proximityLng)
  ) {
    params.lat = String(options!.proximityLat);
    params.lon = String(options!.proximityLng);
  }
  const data = await tomtomGet<TomTomSearchResponse>(
    `${base}/search/${SEARCH_VERSION}/geocode/${encoded}.json`,
    params,
  );
  const results = data?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((row) => parseTomTomResult(row))
    .filter((row): row is OsmGeocodeResult => row != null);
}

/** Géocodage inverse TomTom. */
export async function tomtomReverseGeocode(
  latitude: number,
  longitude: number,
  apiKey: string,
  config?: ConfigService,
): Promise<OsmGeocodeResult | null> {
  if (!apiKey) return null;
  const base = tomtomBase(config);
  const position = `${latitude},${longitude}`;
  const data = await tomtomGet<TomTomSearchResponse>(
    `${base}/search/${SEARCH_VERSION}/reverseGeocode/${position}.json`,
    {
      key: apiKey,
      language: 'fr-FR',
    },
  );
  const first = data?.results?.[0];
  if (!first || typeof first !== 'object') return null;
  return parseTomTomResult(first);
}

/** Valide une adresse structurée via TomTom. */
export async function tomtomSearchStructuredAddress(
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
  const results = await tomtomForwardGeocode(q, apiKey, config, {
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
