import {
  normalizeSitePageLocale,
  normalizeVendorContent,
  pickSitePageByLocale,
} from './site-pages.util';
import { vendorSitePageSeeds } from './vendor-site-page.seed';

describe('site-pages.util', () => {
  describe('normalizeSitePageLocale', () => {
    it('normalise et coupe à 8 chars', () => {
      expect(normalizeSitePageLocale(' EN ')).toBe('en');
      expect(normalizeSitePageLocale('')).toBe('fr');
      expect(normalizeSitePageLocale(undefined)).toBe('fr');
    });
  });

  describe('pickSitePageByLocale', () => {
    const docs = [
      { slug: 'vendor', locale: 'fr', id: 'fr' },
      { slug: 'vendor', locale: 'en', id: 'en' },
    ];

    it('retourne la locale exacte', () => {
      expect(pickSitePageByLocale(docs, 'vendor', 'en')?.id).toBe('en');
    });

    it('fallback FR si EN absent', () => {
      const onlyFr = [{ slug: 'vendor', locale: 'fr', id: 'fr' }];
      expect(pickSitePageByLocale(onlyFr, 'vendor', 'en')?.id).toBe('fr');
    });

    it('retourne undefined si slug inconnu', () => {
      expect(pickSitePageByLocale(docs, 'courier', 'fr')).toBeUndefined();
    });
  });

  describe('normalizeVendorContent', () => {
    it('remplit les blocs manquants sans planter', () => {
      const content = normalizeVendorContent({
        hero: { h1: 'Hello' },
        faq: { items: [{ q: 'Q?', a: 'A', html: true }] },
      });
      expect(content.hero.h1).toBe('Hello');
      expect(content.hero.badge).toBe('');
      expect(content.faq.items[0]).toEqual({ q: 'Q?', a: 'A', html: true });
      expect(content.highlights).toEqual([]);
    });

    it('ignore html non booléen true', () => {
      const content = normalizeVendorContent({
        faq: { items: [{ q: 'Q', a: 'A', html: 'yes' }] },
      });
      expect(content.faq.items[0].html).toBeUndefined();
    });
  });

  describe('vendorSitePageSeeds', () => {
    it('fournit vendor FR+EN avec hero et FAQ', () => {
      const seeds = vendorSitePageSeeds();
      expect(seeds).toHaveLength(2);
      expect(seeds.map((s) => s.locale).sort()).toEqual(['en', 'fr']);
      for (const seed of seeds) {
        expect(seed.slug).toBe('vendor');
        expect(seed.isPublished).toBe(true);
        expect(seed.content.hero.h1.length).toBeGreaterThan(0);
        expect(seed.content.faq.items.length).toBeGreaterThan(0);
        expect(seed.content.tools.imageUrl).toContain('/image/');
      }
    });
  });
});
