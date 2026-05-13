/** Grande distance terrestre approximative (km) via formule de Haversine. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** GeoJSON Point : `coordinates` = [longitude, latitude]. */
export function extractLatLonFromGeoPoint(
  location: { type?: string; coordinates?: number[] } | null | undefined,
): { lat: number; lon: number } | null {
  if (!location?.coordinates || location.coordinates.length < 2) {
    return null;
  }
  const lon = Number(location.coordinates[0]);
  const lat = Number(location.coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  if (lat === 0 && lon === 0) {
    return null;
  }
  return { lat, lon };
}

export type PlatformShippingSettingsForQuote = {
  perKmRate: number;
  maxDeliveryRadiusKm: number;
  ranges: { minKm: number; maxKm: number; fee: number }[];
};

/** Sous ce seuil (bruit GPS / coordonnées), la distance est traitée comme 0 pour le tarif. */
const MIN_BILLABLE_DISTANCE_KM = 0.05;

export function snapDistanceForShippingBillingKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return distanceKm;
  }
  if (distanceKm < MIN_BILLABLE_DISTANCE_KM) {
    return 0;
  }
  return distanceKm;
}

/**
 * Frais plateforme : **total = distance × perKmRate** (dans le rayon max).
 * Les tranches `ranges` ne modulent plus le montant (compat : `rangeFlat` reste 0).
 */
export function computePlatformShippingFeeFromDistance(
  settings: PlatformShippingSettingsForQuote,
  distanceKm: number,
): {
  deliverable: boolean;
  rangeFlat: number;
  perKmComponent: number;
  total: number;
} {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return { deliverable: false, rangeFlat: 0, perKmComponent: 0, total: 0 };
  }
  const d = snapDistanceForShippingBillingKm(distanceKm);
  if (d > settings.maxDeliveryRadiusKm + 1e-9) {
    return { deliverable: false, rangeFlat: 0, perKmComponent: 0, total: 0 };
  }
  const perKmRate = Number(settings.perKmRate) || 0;
  const perKmComponent = d * perKmRate;
  const total = Math.round((perKmComponent + Number.EPSILON) * 100) / 100;
  const perKmRounded =
    Math.round((perKmComponent + Number.EPSILON) * 100) / 100;
  return {
    deliverable: true,
    rangeFlat: 0,
    perKmComponent: perKmRounded,
    total,
  };
}
