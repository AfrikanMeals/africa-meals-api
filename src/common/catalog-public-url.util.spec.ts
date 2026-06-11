import {
  productPublicPath,
  resolveProductPublicUrl,
  resolveStorePublicUrl,
  storePublicSlug,
} from './catalog-public-url.util';

describe('catalog-public-url.util', () => {
  it('builds store slug from id and name', () => {
    expect(
      storePublicSlug('6a1ac069f79292022ab2a4f4', 'Resto 102'),
    ).toBe('6a1ac069f79292022ab2a4f4-resto-102');
  });

  it('builds product path with store and product slugs', () => {
    expect(
      productPublicPath(
        '6a1c99dd9b993caa5e262d56',
        '6a21fdbbfbdc5741e8bc71d4',
        'Gourmet Box',
        'Brochette',
      ),
    ).toBe(
      '/stores/6a1c99dd9b993caa5e262d56-gourmet-box/products/6a21fdbbfbdc5741e8bc71d4-brochette',
    );
  });

  it('falls back to ids when names are missing', () => {
    expect(
      resolveProductPublicUrl(
        'https://wise-eat.com',
        'store456',
        'prod123',
      ),
    ).toBe('https://wise-eat.com/stores/store456/products/prod123');
  });

  it('resolves absolute store and product URLs with slugs', () => {
    expect(
      resolveStorePublicUrl(
        'https://wise-eat.com/',
        '6a1ac069f79292022ab2a4f4',
        'Resto 102',
      ),
    ).toBe('https://wise-eat.com/stores/6a1ac069f79292022ab2a4f4-resto-102');
    expect(
      resolveProductPublicUrl(
        'https://wise-eat.com',
        'store456',
        'prod123',
        'Resto 102',
        'Okok',
      ),
    ).toBe(
      'https://wise-eat.com/stores/store456-resto-102/products/prod123-okok',
    );
  });
});
