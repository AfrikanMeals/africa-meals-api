import type { GeocodeFeature } from '@common/geocode-feature.util';

/** Seuil (m) : même bâtiment / même entrée — on garde le pin Google. */
const SAME_PLACE_METERS = 250;

/**
 * Score Google `geometry.location_type`.
 * ROOFTOP ≈ pin Gmaps ; GEOMETRIC_CENTER = milieu de rue (souvent décalé).
 */
export function googleLocationTypeScore(locationType?: string | null): number {
  switch (String(locationType ?? '').trim().toUpperCase()) {
    case 'ROOFTOP':
      return 400;
    case 'RANGE_INTERPOLATED':
      return 300;
    case 'GEOMETRIC_CENTER':
      return 200;
    case 'APPROXIMATE':
      return 100;
    default:
      return 0;
  }
}

/** Score Mapbox `accuracy` / `coordinates.accuracy`. */
export function mapboxAccuracyScore(accuracy?: string | null): number {
  switch (String(accuracy ?? '').trim().toLowerCase()) {
    case 'rooftop':
      return 400;
    case 'parcel':
      return 350;
    case 'point':
      return 300;
    case 'interpolated':
      return 250;
    case 'intersection':
      return 180;
    case 'street':
      return 80;
    default:
      return 0;
  }
}

export type NominatimPrecisionInput = {
  class?: string | null;
  type?: string | null;
  addresstype?: string | null;
  address?: Record<string, unknown> | null;
  hasHouseNumber?: boolean;
};

/**
 * Nominatim : un `highway` sans numéro = centroïde de rue (écart vs Gmaps).
 * Préférer building / house_number.
 */
export function nominatimPrecisionScore(item: NominatimPrecisionInput): number {
  const house =
    item.hasHouseNumber === true ||
    String(item.address?.house_number ?? '').trim().length > 0;
  const cls = String(item.class ?? '').toLowerCase();
  const type = String(item.type ?? item.addresstype ?? '').toLowerCase();
  let score = 0;
  if (house) score += 200;
  if (cls === 'building' || type === 'house' || type === 'residential') {
    score += 150;
  }
  if (cls === 'place' && (type === 'house' || type === 'isolated_dwelling')) {
    score += 120;
  }
  if (cls === 'amenity' || cls === 'shop') score += 80;
  if (cls === 'highway') score += 30;
  if (
    cls === 'place' &&
    ['city', 'town', 'village', 'municipality', 'county', 'state'].includes(type)
  ) {
    score -= 40;
  }
  return score;
}

/**
 * Requête « rue / numéro » (pas seulement une ville).
 * Sans ça, on ne doit pas forcer `types=address` Mapbox ni un snap Google.
 */
export function looksLikeStreetAddress(query: string): boolean {
  const q = query.trim();
  if (q.length < 6) return false;
  if (/\d/.test(q)) return true;
  return /\b(rue|street|st\.?|avenue|ave\.?|av\.?|bd|boul\.?|boulevard|road|rd\.?|chemin|all[eé]e|drive|dr\.?|lane|ln\.?|way|place|plaza|cours|impasse|route|rte\.?)\b/i.test(
    q,
  );
}

/** Mapbox : n’inclure `place` que si la requête n’est pas une rue numérotée. */
export function mapboxForwardTypesForQuery(query: string): string {
  if (looksLikeStreetAddress(query)) return 'address';
  return 'address,place,locality,neighborhood,district,postcode';
}

/**
 * Proximity Mapbox/TomTom : uniquement un GPS client réel.
 * Fix: le centroïde pays (Yaoundé / Toronto) décalait les pins vs Gmaps.
 */
export function formatGeocodeProximityParam(
  lng?: number,
  lat?: number,
): string {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '';
  return `${Number(lng).toFixed(4)},${Number(lat).toFixed(4)}`;
}

/** Pin Google assez précis pour remplacer OSM/Mapbox (toit ou interpolation). */
export function isGooglePinPreciseEnough(locationType?: string | null): boolean {
  return googleLocationTypeScore(locationType) >= 300;
}

export function sortByScoreDesc<T>(items: T[], score: (item: T) => number): T[] {
  return [...items].sort((a, b) => score(b) - score(a));
}

function featureLngLat(f: GeocodeFeature): [number, number] | null {
  const lng = Number(f.center?.[0]);
  const lat = Number(f.center?.[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/** Distance approximative (m) — assez pour dédupliquer rue vs toit. */
export function approxDistanceMeters(
  a: [number, number],
  b: [number, number],
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function locationTypeOf(f: GeocodeFeature): string {
  return String(f.properties?.locationType ?? '').trim();
}

function isNearExisting(
  candidate: GeocodeFeature,
  existing: GeocodeFeature[],
): boolean {
  const c = featureLngLat(candidate);
  if (!c) return false;
  return existing.some((row) => {
    const p = featureLngLat(row);
    if (!p) return false;
    return approxDistanceMeters(c, p) < SAME_PLACE_METERS;
  });
}

/**
 * Fusionne Google (toit) devant OSM/Mapbox (centroïde de rue).
 * Les pins Google trop vagues (APPROXIMATE) ne remplacent pas un résultat moteur.
 */
export function mergeGeocodeFeaturesPreferringPrecision(
  google: GeocodeFeature[],
  fallback: GeocodeFeature[],
  limit: number,
): GeocodeFeature[] {
  const cap = Math.max(1, Math.trunc(limit) || 5);
  const preciseGoogle = google.filter((f) =>
    isGooglePinPreciseEnough(locationTypeOf(f)),
  );
  const vagueGoogle = google.filter(
    (f) => !isGooglePinPreciseEnough(locationTypeOf(f)),
  );
  const out: GeocodeFeature[] = [];
  for (const f of preciseGoogle) {
    if (isNearExisting(f, out)) continue;
    out.push(f);
    if (out.length >= cap) return out;
  }
  for (const f of fallback) {
    if (isNearExisting(f, out)) continue;
    out.push(f);
    if (out.length >= cap) return out;
  }
  for (const f of vagueGoogle) {
    if (isNearExisting(f, out)) continue;
    out.push(f);
    if (out.length >= cap) return out;
  }
  return out;
}

/** Score d’une ligne Nominatim / Google / TomTom avant conversion feature. */
export function osmResultPrecisionScore(row: {
  locationType?: string;
  osmClass?: string;
  osmType?: string;
  hasHouseNumber?: boolean;
  mapboxAccuracy?: string;
}): number {
  return Math.max(
    googleLocationTypeScore(row.locationType),
    mapboxAccuracyScore(row.mapboxAccuracy),
    nominatimPrecisionScore({
      class: row.osmClass,
      type: row.osmType,
      hasHouseNumber: row.hasHouseNumber,
    }),
  );
}

export function featurePrecisionScore(f: GeocodeFeature): number {
  const props = f.properties ?? {};
  return osmResultPrecisionScore({
    locationType: String(props.locationType ?? ''),
    osmClass: String(props.osmClass ?? ''),
    osmType: String(props.osmType ?? ''),
    hasHouseNumber: props.hasHouseNumber === true,
    mapboxAccuracy: String(props.accuracy ?? ''),
  });
}

export function sortGeocodeFeaturesByPrecision(
  features: GeocodeFeature[],
): GeocodeFeature[] {
  return sortByScoreDesc(features, featurePrecisionScore);
}
