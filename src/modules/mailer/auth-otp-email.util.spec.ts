import {
  buildAppleOtpAutofillLine,
  buildAuthOtpAppDeepLink,
  buildAuthOtpPlainText,
  buildAuthOtpWebDeepLink,
  mapOtpVariantToDeepLinkFlow,
  resolveOtpAutofillDomain,
} from './auth-otp-email.util';

describe('auth-otp-email.util', () => {
  it('builds Apple domain-bound autofill line', () => {
    expect(buildAppleOtpAutofillLine('wise-eat.com', 'abc123')).toBe(
      '@wise-eat.com #ABC123',
    );
  });

  it('maps reset variant to reset deep link flow', () => {
    expect(mapOtpVariantToDeepLinkFlow('reset')).toBe('reset');
    expect(mapOtpVariantToDeepLinkFlow('signup')).toBe('verify');
  });

  it('builds opaque web and app deep links', () => {
    const web = buildAuthOtpWebDeepLink({
      webBaseUrl: 'https://wise-eat.com',
      token: 'opaque-token-123',
    });
    expect(web).toBe('https://wise-eat.com/auth/otp?t=opaque-token-123');

    const app = buildAuthOtpAppDeepLink({
      appScheme: 'wise-eat',
      token: 'opaque-token-123',
    });
    expect(app).toBe('wise-eat://auth/otp?t=opaque-token-123');
  });

  it('includes autofill line in plain text body', () => {
    const text = buildAuthOtpPlainText({
      appName: 'Wise Eat',
      code: '482917',
      variant: 'signup',
      domain: 'wise-eat.com',
      webDeepLink: 'https://wise-eat.com/auth/otp?flow=verify',
    });
    expect(text).toContain('@wise-eat.com #482917');
    expect(text).toContain('Ouvrir dans l’app');
  });

  it('resolves OTP domain from PUBLIC_WEB_URL', () => {
    const domain = resolveOtpAutofillDomain({
      get: (key: string) =>
        key === 'PUBLIC_WEB_URL' ? 'https://wise-eat.com' : undefined,
    });
    expect(domain).toBe('wise-eat.com');
  });
});
