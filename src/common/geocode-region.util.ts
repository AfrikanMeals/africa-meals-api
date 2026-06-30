import { normalizeCountryCode } from './normalize-geocode-query.util';

/** Bbox approximatif [west, south, east, north] pour filtrer géocodage. */
const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  CA: [-141.0, 41.65, -52.6, 83.12],
  US: [-125.0, 24.5, -66.9, 49.5],
  FR: [-5.15, 41.3, 9.65, 51.1],
  SN: [-17.55, 12.3, -11.35, 16.72],
  CI: [-8.6, 4.35, -2.5, 10.74],
  CM: [8.48, 1.65, 16.21, 13.09],
  MA: [-17.02, 21.0, -0.99, 35.93],
  DZ: [-8.67, 19.0, 12.0, 37.12],
  BE: [2.5, 49.5, 6.4, 51.55],
  CH: [5.95, 45.82, 10.49, 47.81],
};

const COUNTRY_CENTER: Record<string, { lng: number; lat: number }> = {
  CA: { lng: -79.38, lat: 43.65 },
  US: { lng: -98.0, lat: 39.5 },
  FR: { lng: 2.35, lat: 48.86 },
  SN: { lng: -17.44, lat: 14.69 },
  CI: { lng: -5.55, lat: 7.54 },
  CM: { lng: 11.52, lat: 3.87 },
  MA: { lng: -6.84, lat: 33.97 },
  DZ: { lng: 3.06, lat: 36.75 },
  BE: { lng: 4.35, lat: 50.85 },
  CH: { lng: 7.45, lat: 46.95 },
};

export function countryMapboxBboxParam(countryCode?: string | null): string | undefined {
  const cc = normalizeCountryCode(countryCode);
  if (!cc) return undefined;
  const bbox = COUNTRY_BBOX[cc];
  if (!bbox) return undefined;
  const [west, south, east, north] = bbox;
  return `${west},${south},${east},${north}`;
}

export function geocodeProximityForCountry(countryCode?: string | null): {
  lng: number;
  lat: number;
} {
  const cc = normalizeCountryCode(countryCode) || 'CA';
  return COUNTRY_CENTER[cc] ?? COUNTRY_CENTER.CA;
}
