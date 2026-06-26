import { normalizeCountryCode } from './client-market-region.util';

/** Centroïde approximatif par marché (tri lat/lon plausibles pour le filtre proximité). */
const REGION_CATALOG_CENTROIDS: Record<string, { lat: number; lon: number }> =
  {
    CA: { lat: 56.13, lon: -106.35 },
    US: { lat: 39.83, lon: -98.58 },
    FR: { lat: 46.6, lon: 2.35 },
    BE: { lat: 50.85, lon: 4.35 },
    CH: { lat: 46.82, lon: 8.23 },
    SN: { lat: 14.69, lon: -17.44 },
    CI: { lat: 5.35, lon: -4.01 },
    CM: { lat: 4.05, lon: 9.7 },
    MA: { lat: 31.79, lon: -7.09 },
    TG: { lat: 6.13, lon: 1.22 },
    BJ: { lat: 6.37, lon: 2.42 },
    GA: { lat: 0.42, lon: 9.45 },
    CD: { lat: -4.04, lon: 21.76 },
    BF: { lat: 12.24, lon: -1.56 },
    ML: { lat: 17.57, lon: -4.0 },
  };

/** Distance max (km) entre le client et le centroïde du marché pour activer le filtre proximité. */
const MAX_GEO_TO_REGION_CENTROID_KM = 1500;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Ignore lat/lng client si elles sont manifestement hors du marché catalogue (simulateur, VPN, adresse legacy). */
export function isGeoPlausibleForCatalogRegion(
  latitude: number,
  longitude: number,
  regionCode: string,
): boolean {
  const code = normalizeCountryCode(regionCode);
  if (!code) return true;
  const centroid = REGION_CATALOG_CENTROIDS[code];
  if (!centroid) return true;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (Math.abs(latitude) < 1e-5 && Math.abs(longitude) < 1e-5)
  ) {
    return false;
  }
  const dist = haversineKm(latitude, longitude, centroid.lat, centroid.lon);
  return dist <= MAX_GEO_TO_REGION_CENTROID_KM;
}
