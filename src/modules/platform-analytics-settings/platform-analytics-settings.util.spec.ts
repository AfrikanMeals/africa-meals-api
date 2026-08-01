import {
  DEFAULT_PLATFORM_ANALYTICS_ADMIN,
  DEFAULT_PLATFORM_ANALYTICS_MOBILE,
  DEFAULT_PLATFORM_ANALYTICS_WEB,
} from './platform-analytics-settings.constants';
import {
  defaultAnalyticsSettingsResponse,
  isAnalyticsToolEnabled,
  mergeAdminFlags,
  mergeMobileFlags,
  mergeWebFlags,
  normalizeAdminFlags,
  normalizeMobileFlags,
  normalizeWebFlags,
  toAnalyticsSettingsResponse,
} from './platform-analytics-settings.util';

describe('platform-analytics-settings.util', () => {
  describe('normalize*Flags', () => {
    it('défaut tout ON si raw absent', () => {
      expect(normalizeAdminFlags(undefined)).toEqual(
        DEFAULT_PLATFORM_ANALYTICS_ADMIN,
      );
      expect(normalizeWebFlags(null)).toEqual(DEFAULT_PLATFORM_ANALYTICS_WEB);
      expect(normalizeMobileFlags({})).toEqual(
        DEFAULT_PLATFORM_ANALYTICS_MOBILE,
      );
    });

    it('seul false explicite désactive', () => {
      expect(normalizeAdminFlags({ matomo: false, ga: true })).toEqual({
        ...DEFAULT_PLATFORM_ANALYTICS_ADMIN,
        matomo: false,
        ga: true,
      });
      expect(normalizeWebFlags({ gtm: false })).toEqual({
        ...DEFAULT_PLATFORM_ANALYTICS_WEB,
        gtm: false,
      });
      expect(normalizeMobileFlags({ firebase: false })).toEqual({
        ...DEFAULT_PLATFORM_ANALYTICS_MOBILE,
        firebase: false,
      });
    });

    it('ignore valeurs non booléennes', () => {
      expect(
        normalizeAdminFlags({ matomo: 'no' as unknown as boolean }),
      ).toEqual(DEFAULT_PLATFORM_ANALYTICS_ADMIN);
    });
  });

  describe('merge*Flags', () => {
    it('merge partiel admin / web / mobile', () => {
      const admin = mergeAdminFlags(DEFAULT_PLATFORM_ANALYTICS_ADMIN, {
        gtm: false,
      });
      expect(admin.gtm).toBe(false);
      expect(admin.matomo).toBe(true);

      const web = mergeWebFlags(DEFAULT_PLATFORM_ANALYTICS_WEB, {
        matomo: false,
      });
      expect(web.matomo).toBe(false);
      expect(web.ga).toBe(true);

      const mobile = mergeMobileFlags(DEFAULT_PLATFORM_ANALYTICS_MOBILE, {
        facebook: false,
      });
      expect(mobile.facebook).toBe(false);
      expect(mobile.firebase).toBe(true);
    });

    it('patch vide laisse current intact', () => {
      expect(
        mergeAdminFlags(DEFAULT_PLATFORM_ANALYTICS_ADMIN, undefined),
      ).toEqual(DEFAULT_PLATFORM_ANALYTICS_ADMIN);
    });
  });

  describe('toAnalyticsSettingsResponse / default', () => {
    it('mappe un doc Mongo', () => {
      const res = toAnalyticsSettingsResponse({
        key: 'default',
        admin: { matomo: false, ga: true, gtm: true, fbPixel: true },
        web: { matomo: true, ga: false, gtm: true },
        mobile: { firebase: true, gtm: false, facebook: true },
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      expect(res.admin.matomo).toBe(false);
      expect(res.web.ga).toBe(false);
      expect(res.mobile.gtm).toBe(false);
      expect(res.updatedAt).toBe('2026-08-01T00:00:00.000Z');
    });

    it('defaultAnalyticsSettingsResponse tout ON', () => {
      const res = defaultAnalyticsSettingsResponse();
      expect(res.admin).toEqual(DEFAULT_PLATFORM_ANALYTICS_ADMIN);
      expect(res.web).toEqual(DEFAULT_PLATFORM_ANALYTICS_WEB);
      expect(res.mobile).toEqual(DEFAULT_PLATFORM_ANALYTICS_MOBILE);
      expect(res.updatedAt).toBeNull();
    });
  });

  describe('isAnalyticsToolEnabled', () => {
    it('platformFlag && userPref', () => {
      expect(isAnalyticsToolEnabled(true, true)).toBe(true);
      expect(isAnalyticsToolEnabled(false, true)).toBe(false);
      expect(isAnalyticsToolEnabled(true, false)).toBe(false);
      expect(isAnalyticsToolEnabled(undefined, true)).toBe(true);
      expect(isAnalyticsToolEnabled(true, undefined)).toBe(true);
    });
  });
});
