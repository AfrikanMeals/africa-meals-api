import {
  canonicalizeEmailWebsiteUrl,
  mapEmailObjectPathToWebUrl,
  resolveEmailWebAssetUrl,
  resolveEmailWebSiteBase,
} from './email-web-asset-url.util';

const BASE = 'https://wise-eat.com';

describe('email-web-asset-url.util', () => {
  it('canonicalizeEmailWebsiteUrl : web.wise-eat.com → wise-eat.com', () => {
    expect(canonicalizeEmailWebsiteUrl('https://web.wise-eat.com')).toBe(
      'https://wise-eat.com',
    );
    expect(
      canonicalizeEmailWebsiteUrl('https://web.wise-eat.com/images/help/a.png'),
    ).toBe('https://wise-eat.com/images/help/a.png');
  });

  it('resolveEmailWebSiteBase ignore l’alias web.wise-eat.com', () => {
    const config = {
      get: (key: string) =>
        key === 'EMAIL_WEBSITE_URL' ? 'https://web.wise-eat.com/' : undefined,
    };
    expect(resolveEmailWebSiteBase(config)).toBe('https://wise-eat.com');
  });

  it('resolveEmailWebAssetUrl réécrit un src déjà en web.wise-eat.com', () => {
    expect(
      resolveEmailWebAssetUrl(
        'https://web.wise-eat.com/images/email-heroes/vendor-onboarding-01.png',
        'https://web.wise-eat.com',
      ),
    ).toBe('https://wise-eat.com/images/email-heroes/vendor-onboarding-01.png');
  });

  it('maps platform-theme logo to /logo.png', () => {
    expect(
      mapEmailObjectPathToWebUrl('platform-theme/logo.png', BASE),
    ).toBe('https://wise-eat.com/logo.png');
  });

  it('maps email-heroes vendor gemini path to curated web file', () => {
    expect(
      mapEmailObjectPathToWebUrl(
        'email-heroes/onboarding/vendor/abc.png',
        BASE,
      ),
    ).toBe('https://wise-eat.com/images/email-heroes/vendor-onboarding-01.png');
  });

  it('maps catalog paths to web placeholders (never GCS)', () => {
    expect(mapEmailObjectPathToWebUrl('catalog/meal.jpg', BASE)).toBe(
      'https://wise-eat.com/images/email/catalog/meal.jpg',
    );
    expect(
      mapEmailObjectPathToWebUrl('catalog/stores/abc/products/xyz.jpg', BASE),
    ).toBe('https://wise-eat.com/images/email/catalog/product-placeholder.jpg');
  });

  it('rewrites Firebase URL to web static asset', () => {
    const legacy =
      'https://firebasestorage.googleapis.com/v0/b/wise-eat-com/o/platform-theme%2Flogo.png?alt=media';
    expect(resolveEmailWebAssetUrl(legacy, BASE)).toBe(
      'https://wise-eat.com/logo.png',
    );
  });

  it('rewrites GCS catalog URL to web (not GCS)', () => {
    const gcs = 'https://storage.googleapis.com/wise-eat/catalog/meal-123.jpg';
    expect(resolveEmailWebAssetUrl(gcs, BASE)).toBe(
      'https://wise-eat.com/images/email/catalog/product-placeholder.jpg',
    );
  });

  it('rewrites proxy API media URL to web', () => {
    const proxy =
      'https://api.wise-eat.com/medias/public/catalog/meal.jpg';
    expect(resolveEmailWebAssetUrl(proxy, BASE)).toBe(
      'https://wise-eat.com/images/email/catalog/meal.jpg',
    );
  });
});
