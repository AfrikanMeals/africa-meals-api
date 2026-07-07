import { haversineDistance } from '@utils/helpers';

/** Distance en mètres entre deux points WGS84. */
export function distanceMetersBetweenPoints(args: {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
}): number {
  const km = haversineDistance(
    [args.fromLng, args.fromLat],
    [args.toLng, args.toLat],
  );
  return Math.round(km * 1000);
}

export function isMeaningfulGeoCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

export function formatDistanceMetersLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
