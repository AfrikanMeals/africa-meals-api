import {
  isValidWgs84,
  parseGeoSearchWithDist,
} from './courier-geo.util';

describe('courier-geo.util', () => {
  it('parseGeoSearchWithDist lit paires nested', () => {
    expect(
      parseGeoSearchWithDist([
        ['a1', '1.5'],
        ['a2', '3'],
      ]),
    ).toEqual([
      { member: 'a1', distanceKm: 1.5 },
      { member: 'a2', distanceKm: 3 },
    ]);
  });

  it('parseGeoSearchWithDist lit flat member/dist', () => {
    expect(parseGeoSearchWithDist(['u1', '0.25', 'u2', '2'])).toEqual([
      { member: 'u1', distanceKm: 0.25 },
      { member: 'u2', distanceKm: 2 },
    ]);
  });

  it('isValidWgs84 rejette hors bornes', () => {
    expect(isValidWgs84(3.85, 11.5)).toBe(true);
    expect(isValidWgs84(91, 0)).toBe(false);
    expect(isValidWgs84(0, 181)).toBe(false);
  });
});
