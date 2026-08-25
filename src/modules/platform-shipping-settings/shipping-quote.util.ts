/** Arrondi facturable : millième de km (~1 m). */
export function roundBillableDistanceKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm)) return distanceKm;
  return Math.round(distanceKm * 1000) / 1000;
}

/**
 * Distance facturable : itinéraire routier prioritaire, Haversine en plancher
 * (un moteur ne doit jamais facturer moins que le vol d’oiseau).
 */
export function pickBillableDistanceKm(
  haversineKm: number,
  routeKm: number | null | undefined,
): number {
  // Plancher Haversine : un snap réseau trop court ne doit pas sous-facturer.
  if (routeKm != null && Number.isFinite(routeKm) && routeKm > 0) {
    return roundBillableDistanceKm(Math.max(routeKm, haversineKm));
  }
  return roundBillableDistanceKm(haversineKm);
}

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

export type PlatformShippingRangeForQuote = {
  minKm: number;
  maxKm: number;
  basePrice?: number;
  /** Tarif au km propre à la tranche (remplace le global lorsque la distance tombe dans [minKm, maxKm)). */
  fee: number;
};

export type PlatformShippingSettingsForQuote = {
  perKmRate: number;
  deliveryBasePrice: number;
  maxDeliveryRadiusKm: number;
  ranges: PlatformShippingRangeForQuote[];
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

/** Tranche [minKm, maxKm) correspondante ou null. */
export function findMatchingPlatformRange(
  ranges: PlatformShippingRangeForQuote[],
  distanceKm: number,
): PlatformShippingRangeForQuote | null {
  if (!ranges?.length) {
    return null;
  }
  for (const r of ranges) {
    const minKm = Number(r.minKm);
    const maxKm = Number(r.maxKm);
    if (distanceKm >= minKm && distanceKm < maxKm) {
      return r;
    }
  }
  return null;
}

/** @deprecated Préférer `findPlatformRangePerKmRate` */
export function findPlatformRangeFlat(
  ranges: PlatformShippingRangeForQuote[],
  distanceKm: number,
): number {
  return findPlatformRangePerKmRate(ranges, distanceKm);
}

/** Tarif au km de la tranche correspondante, ou 0 si aucune tranche. */
export function findPlatformRangePerKmRate(
  ranges: PlatformShippingRangeForQuote[],
  distanceKm: number,
): number {
  const match = findMatchingPlatformRange(ranges, distanceKm);
  return match ? Number(match.fee) || 0 : 0;
}

/**
 * Résout prix de base et tarif au km effectif pour une distance.
 * - Tranche trouvée : base = basePrice tranche si défini, sinon deliveryBasePrice global ; km = fee tranche.
 * - Hors tranche : base = deliveryBasePrice global ; km = perKmRate global.
 */
export function resolvePlatformRangePricing(
  ranges: PlatformShippingRangeForQuote[],
  distanceKm: number,
  globalDeliveryBasePrice: number,
  globalPerKmRate: number,
): {
  deliveryBasePrice: number;
  perKmRateEffective: number;
  matchedRange: PlatformShippingRangeForQuote | null;
} {
  const globalBase = Number(globalDeliveryBasePrice) || 0;
  const globalKm = Number(globalPerKmRate) || 0;
  const match = findMatchingPlatformRange(ranges ?? [], distanceKm);
  if (!match) {
    return {
      deliveryBasePrice: globalBase,
      perKmRateEffective: globalKm,
      matchedRange: null,
    };
  }
  const hasRangeBase =
    match.basePrice !== undefined && match.basePrice !== null;
  const deliveryBasePrice = hasRangeBase
    ? Math.max(0, Number(match.basePrice) || 0)
    : globalBase;
  return {
    deliveryBasePrice,
    perKmRateEffective: Number(match.fee) || 0,
    matchedRange: match,
  };
}

/**
 * Frais plateforme (dans le rayon max) :
 * **total = prix de base (tranche ou global) + distance × tarif au km (tranche ou global)**.
 */
export function computePlatformShippingFeeFromDistance(
  settings: PlatformShippingSettingsForQuote,
  distanceKm: number,
): {
  deliverable: boolean;
  /** @deprecated Toujours 0 — le champ `fee` tranche est un tarif au km, plus un forfait fixe. */
  rangeFlat: number;
  rangePerKmRate: number;
  perKmRateEffective: number;
  deliveryBasePrice: number;
  perKmComponent: number;
  total: number;
} {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return {
      deliverable: false,
      rangeFlat: 0,
      rangePerKmRate: 0,
      perKmRateEffective: 0,
      deliveryBasePrice: 0,
      perKmComponent: 0,
      total: 0,
    };
  }
  const d = snapDistanceForShippingBillingKm(distanceKm);
  if (d > settings.maxDeliveryRadiusKm + 1e-9) {
    return {
      deliverable: false,
      rangeFlat: 0,
      rangePerKmRate: 0,
      perKmRateEffective: 0,
      deliveryBasePrice: 0,
      perKmComponent: 0,
      total: 0,
    };
  }
  const { deliveryBasePrice, perKmRateEffective, matchedRange } =
    resolvePlatformRangePricing(
      settings.ranges ?? [],
      d,
      settings.deliveryBasePrice,
      settings.perKmRate,
    );
  const perKmComponent = d * perKmRateEffective;
  const rawTotal = deliveryBasePrice + perKmComponent;
  const total = Math.round((rawTotal + Number.EPSILON) * 100) / 100;
  const perKmRounded =
    Math.round((perKmComponent + Number.EPSILON) * 100) / 100;
  const baseRounded =
    Math.round((deliveryBasePrice + Number.EPSILON) * 100) / 100;
  return {
    deliverable: true,
    rangeFlat: 0,
    rangePerKmRate: matchedRange ? perKmRateEffective : 0,
    perKmRateEffective,
    deliveryBasePrice: baseRounded,
    perKmComponent: perKmRounded,
    total,
  };
}
