import {
  distanceMetersBetweenPoints,
  formatDistanceMetersLabel,
  isMeaningfulGeoCoordinate,
} from './pending-delivery.util';

describe('pending-delivery.util', () => {
  describe('isMeaningfulGeoCoordinate', () => {
    it('rejette origine nulle et coordonnées invalides', () => {
      expect(isMeaningfulGeoCoordinate(0, 0)).toBe(false);
      expect(isMeaningfulGeoCoordinate(91, 0)).toBe(false);
      expect(isMeaningfulGeoCoordinate(Number.NaN, 2)).toBe(false);
    });

    it('accepte des coordonnées valides', () => {
      expect(isMeaningfulGeoCoordinate(45.5017, -73.5673)).toBe(true);
    });
  });

  describe('distanceMetersBetweenPoints', () => {
    it('calcule une distance proche de zéro pour le même point', () => {
      const meters = distanceMetersBetweenPoints({
        fromLat: 3.848,
        fromLng: 11.502,
        toLat: 3.848,
        toLng: 11.502,
      });
      expect(meters).toBe(0);
    });

    it('retourne une distance positive entre deux points distincts', () => {
      const meters = distanceMetersBetweenPoints({
        fromLat: 45.5017,
        fromLng: -73.5673,
        toLat: 45.5088,
        toLng: -73.554,
      });
      expect(meters).toBeGreaterThan(500);
      expect(meters).toBeLessThan(2000);
    });
  });

  describe('formatDistanceMetersLabel', () => {
    it('formate en mètres ou kilomètres', () => {
      expect(formatDistanceMetersLabel(450)).toBe('450 m');
      expect(formatDistanceMetersLabel(1500)).toBe('1.5 km');
      expect(formatDistanceMetersLabel(-1)).toBe('—');
    });
  });
});
