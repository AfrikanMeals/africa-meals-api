import {
  emptyAppVersioning,
  isAppVersionOutdated,
  normalizeAppVersioning,
  remainingUpdateDays,
} from './app-versioning.util';

describe('app-versioning.util', () => {
  describe('isAppVersionOutdated', () => {
    it('false si buildId vide', () => {
      expect(
        isAppVersionOutdated({ clientBuild: 10, minBuildId: '' }),
      ).toBe(false);
    });

    it('true si client < min', () => {
      expect(
        isAppVersionOutdated({ clientBuild: 100, minBuildId: '184' }),
      ).toBe(true);
    });

    it('false si client >= min', () => {
      expect(
        isAppVersionOutdated({ clientBuild: '184', minBuildId: '184' }),
      ).toBe(false);
      expect(
        isAppVersionOutdated({ clientBuild: 200, minBuildId: '184' }),
      ).toBe(false);
    });

    it('false si minBuildId non numérique', () => {
      expect(
        isAppVersionOutdated({ clientBuild: 1, minBuildId: 'abc' }),
      ).toBe(false);
    });
  });

  describe('remainingUpdateDays', () => {
    it('null sans date', () => {
      expect(remainingUpdateDays(null)).toBeNull();
      expect(remainingUpdateDays('')).toBeNull();
    });

    it('0 si deadline passée', () => {
      expect(
        remainingUpdateDays('2020-01-01', new Date('2026-08-03T12:00:00Z')),
      ).toBe(0);
    });

    it('calcule les jours restants', () => {
      const days = remainingUpdateDays(
        '2026-08-10',
        new Date('2026-08-03T12:00:00Z'),
      );
      expect(days).toBeGreaterThanOrEqual(7);
      expect(days).toBeLessThanOrEqual(8);
    });
  });

  describe('normalizeAppVersioning', () => {
    it('défauts vides', () => {
      expect(normalizeAppVersioning(null)).toEqual(emptyAppVersioning());
    });

    it('parse android/ios', () => {
      const n = normalizeAppVersioning({
        android: {
          versionNumber: '2.4.1',
          buildId: '184',
          whatsNewHtml: '<p>Hi</p>',
          required: true,
          updateBefore: '2026-09-01T00:00:00.000Z',
        },
      });
      expect(n.android.versionNumber).toBe('2.4.1');
      expect(n.android.buildId).toBe('184');
      expect(n.android.required).toBe(true);
      expect(n.android.updateBefore).toBe('2026-09-01');
      expect(n.ios.required).toBe(false);
    });
  });
});
