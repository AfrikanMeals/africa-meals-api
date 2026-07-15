import {
  AD_REGION_ALL,
  adRegionMatchesClient,
  isAdRegionAll,
  normalizeAdRegionScope,
} from './ad-region-scope.util';

describe('ad-region-scope.util', () => {
  describe('isAdRegionAll', () => {
    it('accepte ALL / * / GLOBAL (insensible à la casse)', () => {
      expect(isAdRegionAll('ALL')).toBe(true);
      expect(isAdRegionAll('all')).toBe(true);
      expect(isAdRegionAll('*')).toBe(true);
      expect(isAdRegionAll('GLOBAL')).toBe(true);
    });

    it('rejette ISO2 et vide', () => {
      expect(isAdRegionAll('CA')).toBe(false);
      expect(isAdRegionAll('')).toBe(false);
      expect(isAdRegionAll(null)).toBe(false);
    });
  });

  describe('normalizeAdRegionScope', () => {
    it('normalise ALL et ISO2', () => {
      expect(normalizeAdRegionScope('all')).toBe(AD_REGION_ALL);
      expect(normalizeAdRegionScope('cm')).toBe('CM');
      expect(normalizeAdRegionScope('XYZ')).toBeNull();
      expect(normalizeAdRegionScope('')).toBeNull();
    });
  });

  describe('adRegionMatchesClient', () => {
    it('ALL matche toute région client', () => {
      expect(adRegionMatchesClient('CA', 'ALL')).toBe(true);
      expect(adRegionMatchesClient('CM', '*')).toBe(true);
      expect(adRegionMatchesClient(undefined, 'ALL')).toBe(true);
    });

    it('ISO2 ne matche que la même région', () => {
      expect(adRegionMatchesClient('CA', 'CA')).toBe(true);
      expect(adRegionMatchesClient('CM', 'CA')).toBe(false);
    });

    it('sans région client → toujours true', () => {
      expect(adRegionMatchesClient(undefined, 'CA')).toBe(true);
      expect(adRegionMatchesClient('', null)).toBe(true);
    });

    it('région pub vide avec client → false', () => {
      expect(adRegionMatchesClient('CA', '')).toBe(false);
      expect(adRegionMatchesClient('CA', null)).toBe(false);
    });
  });
});
