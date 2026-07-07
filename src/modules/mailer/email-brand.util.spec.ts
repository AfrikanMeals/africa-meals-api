import {
  normalizeEmailBrandColor,
  resolveEmailBrand,
} from './email-brand.util';

describe('email-brand.util', () => {
  describe('normalizeEmailBrandColor', () => {
    it('strips surrounding quotes from .env values', () => {
      expect(normalizeEmailBrandColor('"#392800"', '#000000')).toBe('#392800');
      expect(normalizeEmailBrandColor("'#aa6900'", '#000000')).toBe('#aa6900');
    });

    it('falls back when empty', () => {
      expect(normalizeEmailBrandColor('  ', '#392800')).toBe('#392800');
    });
  });

  describe('resolveEmailBrand', () => {
    it('uses EMAIL_LOGO_URL, EMAIL_WEBSITE_URL and brand colors from env', () => {
      const brand = resolveEmailBrand({
        get: (key: string) => {
          const map: Record<string, string> = {
            APP_NAME: 'Wise Eat',
            EMAIL_LOGO_URL: 'https://web.wise-eat.com/logo.png',
            EMAIL_WEBSITE_URL: 'https://web.wise-eat.com',
            PUBLIC_WEB_URL: 'https://other.example.com',
            EMAIL_BRAND_PRIMARY: '"#392800"',
            EMAIL_BRAND_ACCENT: '"#aa6900"',
          };
          return map[key];
        },
      });

      expect(brand.logoUrl).toBe('https://web.wise-eat.com/logo.png');
      expect(brand.websiteUrl).toBe('https://web.wise-eat.com');
      expect(brand.colors.primary).toBe('#392800');
      expect(brand.colors.accent).toBe('#aa6900');
    });
  });
});
