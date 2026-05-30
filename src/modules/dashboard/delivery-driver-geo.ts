/**
 * Zone de référence (péninsule de Dakar) pour placer les livreurs sur la carte
 * quand seuls les pourcentages `coords` existent en base.
 */
export const DAKAR_FLOTTE_BBOX = {
  west: -17.56,
  east: -17.41,
  north: 14.805,
  south: 14.635,
} as const;

export function lngLatFromPercentCoords(coords: { x: number; y: number }): {
  longitude: number;
  latitude: number;
} {
  const { west, east, north, south } = DAKAR_FLOTTE_BBOX;
  const u = coords.x / 100;
  const t = coords.y / 100;
  return {
    longitude: west + u * (east - west),
    latitude: north - t * (north - south),
  };
}

export function coordsFromLngLat(
  longitude: number,
  latitude: number,
): { x: number; y: number } {
  const { west, east, north, south } = DAKAR_FLOTTE_BBOX;
  const x = ((longitude - west) / (east - west)) * 100;
  const y = ((north - latitude) / (north - south)) * 100;
  return {
    x: Math.min(95, Math.max(5, Math.round(x))),
    y: Math.min(95, Math.max(5, Math.round(y))),
  };
}

export function randomLngLatInBbox(): { longitude: number; latitude: number } {
  const { west, east, north, south } = DAKAR_FLOTTE_BBOX;
  return {
    longitude: west + Math.random() * (east - west),
    latitude: south + Math.random() * (north - south),
  };
}

/** Petit décalage autour du point boutique (WGS84). */
export function randomLngLatNearPoint(
  longitude: number,
  latitude: number,
  spreadDeg = 0.016,
): { longitude: number; latitude: number } {
  return {
    longitude: longitude + (Math.random() - 0.5) * spreadDeg,
    latitude: latitude + (Math.random() - 0.5) * spreadDeg,
  };
}

/** Coordonnées % pour champs legacy `coords` (sans lien géographique strict). */
export function randomPercentCoords(): { x: number; y: number } {
  return {
    x: Math.min(90, Math.max(10, Math.round(12 + Math.random() * 76))),
    y: Math.min(90, Math.max(10, Math.round(12 + Math.random() * 76))),
  };
}
