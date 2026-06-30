import { GEOCODE_MIN_QUERY_LENGTH } from '@common/normalize-geocode-query.util';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

const DEFAULT_NOMINATIM = 'https://nominatim.openstreetmap.org';
const DEFAULT_USER_AGENT = 'WiseEat/1.0 (address geocoding)';

export type OsmGeocodeResult = {
  address: string;
  country: string;
  countryCode: string;
  city: string;
  zipCode: string;
  latitude: number;
  longitude: number;
};

function nominatimBase(config?: ConfigService): string {
  const raw =
    config?.get<string>('OSM_NOMINATIM_BASE_URL')?.trim() ||
    process.env.OSM_NOMINATIM_BASE_URL?.trim() ||
    DEFAULT_NOMINATIM;
  return raw.replace(/\/+$/, '');
}

function nominatimHeaders(config?: ConfigService): Record<string, string> {
  const ua =
    config?.get<string>('OSM_NOMINATIM_USER_AGENT')?.trim() ||
    process.env.OSM_NOMINATIM_USER_AGENT?.trim() ||
    DEFAULT_USER_AGENT;
  return { 'User-Agent': ua, Accept: 'application/json' };
}

function pickAddressField(
  addr: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!addr) return '';
  for (const k of keys) {
    const v = String(addr[k] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function parseNominatimItem(item: Record<string, unknown>): OsmGeocodeResult | null {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const addr = item.address as Record<string, unknown> | undefined;
  const street = pickAddressField(addr, [
    'road',
    'pedestrian',
    'footway',
    'house_number',
  ]);
  const house = pickAddressField(addr, ['house_number']);
  const line =
    [house, street].filter(Boolean).join(' ').trim() ||
    String(item.display_name ?? '').split(',')[0]?.trim() ||
    '';
  const city = pickAddressField(addr, [
    'city',
    'town',
    'village',
    'municipality',
    'county',
  ]);
  const zipCode = pickAddressField(addr, ['postcode']);
  const country = pickAddressField(addr, ['country']);
  const countryCode = pickAddressField(addr, ['country_code']).toUpperCase();
  return {
    address: line,
    country,
    countryCode,
    city,
    zipCode,
    latitude: lat,
    longitude: lon,
  };
}

/** Recherche d’adresse via Nominatim (OpenStreetMap). */
export async function osmForwardGeocode(
  query: string,
  config?: ConfigService,
  options?: { limit?: number; countryCode?: string },
): Promise<OsmGeocodeResult[]> {
  const q = query.trim();
  if (q.length < GEOCODE_MIN_QUERY_LENGTH) return [];
  const base = nominatimBase(config);
  const params: Record<string, string> = {
    q,
    format: 'json',
    addressdetails: '1',
    limit: String(options?.limit ?? 6),
  };
  const cc = options?.countryCode?.trim().toUpperCase();
  if (cc) params.countrycodes = cc.toLowerCase();
  const { data } = await axios.get<Record<string, unknown>[]>(`${base}/search`, {
    params,
    headers: nominatimHeaders(config),
    timeout: 14_000,
  });
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => parseNominatimItem(row))
    .filter((row): row is OsmGeocodeResult => row != null);
}

/** Géocodage inverse Nominatim. */
export async function osmReverseGeocode(
  latitude: number,
  longitude: number,
  config?: ConfigService,
): Promise<OsmGeocodeResult | null> {
  const base = nominatimBase(config);
  const { data } = await axios.get<Record<string, unknown>>(`${base}/reverse`, {
    params: {
      lat: latitude,
      lon: longitude,
      format: 'json',
      addressdetails: 1,
    },
    headers: nominatimHeaders(config),
    timeout: 14_000,
  });
  if (!data || typeof data !== 'object') return null;
  return parseNominatimItem(data);
}

/** Valide une adresse structurée (recherche + filtre code postal si fourni). */
export async function osmSearchStructuredAddress(
  args: {
    address: string;
    city: string;
    country: string;
    zipCode: string;
    countryCode?: string;
  },
  config?: ConfigService,
): Promise<OsmGeocodeResult | null> {
  const q = [args.address, args.city, args.country, args.zipCode]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(', ');
  const results = await osmForwardGeocode(q, config, {
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
