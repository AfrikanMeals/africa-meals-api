import {
  portalAudienceForUserType,
  resolvePortalAppBaseUrl,
} from './portal-app-base-url.util';

describe('portal-app-base-url.util', () => {
  describe('portalAudienceForUserType', () => {
    it('mappe ADMIN → admin, autres → business', () => {
      expect(portalAudienceForUserType('ADMIN')).toBe('admin');
      expect(portalAudienceForUserType('VENDOR')).toBe('business');
      expect(portalAudienceForUserType('PARTNER')).toBe('business');
      expect(portalAudienceForUserType('DELIVERY')).toBe('business');
      expect(portalAudienceForUserType('USER')).toBe('business');
      expect(portalAudienceForUserType(null)).toBe('business');
    });
  });

  describe('resolvePortalAppBaseUrl', () => {
    const env: Record<string, string> = {
      ADMIN_APP_URL: 'https://admin.wise-eat.com',
      BUSINESS_APP_URL: 'https://business.wise-eat.com',
      FRONTEND_URL: 'https://frontend.example',
      DASHBOARD_BASE_URL: 'https://dashboard.example',
    };
    const getEnv = (key: string) => env[key];

    it('ADMIN → ADMIN_APP_URL', () => {
      expect(
        resolvePortalAppBaseUrl({ getEnv, userType: 'ADMIN' }),
      ).toBe('https://admin.wise-eat.com');
    });

    it('VENDOR / PARTNER → BUSINESS_APP_URL (pas admin)', () => {
      expect(
        resolvePortalAppBaseUrl({ getEnv, userType: 'VENDOR' }),
      ).toBe('https://business.wise-eat.com');
      expect(
        resolvePortalAppBaseUrl({ getEnv, userType: 'PARTNER' }),
      ).toBe('https://business.wise-eat.com');
    });

    it('audience business forcée ignore le type ADMIN', () => {
      expect(
        resolvePortalAppBaseUrl({
          getEnv,
          userType: 'ADMIN',
          audience: 'business',
        }),
      ).toBe('https://business.wise-eat.com');
    });

    it('sans BUSINESS_APP_URL : DASHBOARD puis FRONTEND', () => {
      const partial = { ...env };
      delete partial.BUSINESS_APP_URL;
      expect(
        resolvePortalAppBaseUrl({
          getEnv: (k) => partial[k],
          userType: 'VENDOR',
        }),
      ).toBe('https://dashboard.example');
    });

    it('ne retombe pas sur ADMIN pour un vendeur sans env business', () => {
      expect(
        resolvePortalAppBaseUrl({
          getEnv: (k) =>
            k === 'ADMIN_APP_URL' ? 'https://admin.wise-eat.com' : undefined,
          userType: 'VENDOR',
          localhostFallback: 'http://localhost:3000',
        }),
      ).toBe('http://localhost:3000');
    });
  });
});
