import {
  approxDistanceMeters,
  formatGeocodeProximityParam,
  googleLocationTypeScore,
  isGooglePinPreciseEnough,
  looksLikeStreetAddress,
  mapboxAccuracyScore,
  mapboxForwardTypesForQuery,
  mergeGeocodeFeaturesPreferringPrecision,
  nominatimPrecisionScore,
  sortByScoreDesc,
} from './geocode-precision.util';
import type { GeocodeFeature } from './geocode-feature.util';

function feat(
  lng: number,
  lat: number,
  props?: Record<string, unknown>,
): GeocodeFeature {
  return {
    place_name: `${lat},${lng}`,
    center: [lng, lat],
    properties: props,
  };
}

describe('geocode-precision.util', () => {
  it('classe Google location_type : rooftop > interpolation > centroïde', () => {
    expect(googleLocationTypeScore('ROOFTOP')).toBeGreaterThan(
      googleLocationTypeScore('RANGE_INTERPOLATED'),
    );
    expect(googleLocationTypeScore('RANGE_INTERPOLATED')).toBeGreaterThan(
      googleLocationTypeScore('GEOMETRIC_CENTER'),
    );
    expect(googleLocationTypeScore('GEOMETRIC_CENTER')).toBeGreaterThan(
      googleLocationTypeScore('APPROXIMATE'),
    );
    expect(isGooglePinPreciseEnough('ROOFTOP')).toBe(true);
    expect(isGooglePinPreciseEnough('RANGE_INTERPOLATED')).toBe(true);
    expect(isGooglePinPreciseEnough('GEOMETRIC_CENTER')).toBe(false);
  });

  it('classe Mapbox accuracy : rooftop > street', () => {
    expect(mapboxAccuracyScore('rooftop')).toBeGreaterThan(
      mapboxAccuracyScore('interpolated'),
    );
    expect(mapboxAccuracyScore('interpolated')).toBeGreaterThan(
      mapboxAccuracyScore('street'),
    );
  });

  it('préfère Nominatim building + house_number au highway', () => {
    const house = nominatimPrecisionScore({
      class: 'building',
      type: 'yes',
      hasHouseNumber: true,
    });
    const street = nominatimPrecisionScore({
      class: 'highway',
      type: 'residential',
      hasHouseNumber: false,
    });
    expect(house).toBeGreaterThan(street);
  });

  it('détecte une rue (numéro ou lexique) vs une ville', () => {
    expect(looksLikeStreetAddress('12 rue de la Joie Douala')).toBe(true);
    expect(looksLikeStreetAddress('742 Evergreen Terrace')).toBe(true);
    expect(looksLikeStreetAddress('Douala')).toBe(false);
    expect(looksLikeStreetAddress('Yaoundé')).toBe(false);
  });

  it('restreint Mapbox types=address pour une rue numérotée', () => {
    expect(mapboxForwardTypesForQuery('15 Avenue Kennedy')).toBe('address');
    expect(mapboxForwardTypesForQuery('Douala')).toContain('place');
  });

  it('ne fabrique pas de proximité centroïde pays', () => {
    expect(formatGeocodeProximityParam(undefined, undefined)).toBe('');
    expect(formatGeocodeProximityParam(9.767, 4.051)).toBe('9.7670,4.0510');
  });

  it('trie par score décroissant', () => {
    const sorted = sortByScoreDesc(
      [
        { id: 'a', n: 1 },
        { id: 'b', n: 9 },
        { id: 'c', n: 3 },
      ],
      (x) => x.n,
    );
    expect(sorted.map((x) => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('place le rooftop Google devant le centroïde OSM de la même rue', () => {
    // OSM ~80 m plus à l’est (centroïde de rue typique).
    const osm = feat(9.768, 4.051);
    const google = feat(9.7673, 4.0512, { locationType: 'ROOFTOP' });
    const merged = mergeGeocodeFeaturesPreferringPrecision([google], [osm], 5);
    expect(merged[0]).toBe(google);
    expect(merged).toHaveLength(1);
  });

  it('ne laisse pas un Google APPROXIMATE (ville) écraser un pin OSM', () => {
    const osm = feat(9.767, 4.051);
    const city = feat(11.52, 3.87, { locationType: 'APPROXIMATE' });
    const merged = mergeGeocodeFeaturesPreferringPrecision([city], [osm], 5);
    expect(merged[0]).toBe(osm);
    expect(merged).toContain(city);
  });

  it('approxDistanceMeters ~80 m pour un petit décalage urbain', () => {
    const m = approxDistanceMeters([9.767, 4.051], [9.7677, 4.051]);
    expect(m).toBeGreaterThan(50);
    expect(m).toBeLessThan(120);
  });
});
