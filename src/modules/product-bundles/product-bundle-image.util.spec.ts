import { normalizeBundleCoverImage, isAllowedBundleImageFilename } from './product-bundle-image.util';

describe('normalizeBundleCoverImage', () => {
  it('trim et refuse vide / null', () => {
    expect(normalizeBundleCoverImage('  https://cdn.example/b.jpg  ')).toBe(
      'https://cdn.example/b.jpg',
    );
    expect(normalizeBundleCoverImage('')).toBeUndefined();
    expect(normalizeBundleCoverImage('   ')).toBeUndefined();
    expect(normalizeBundleCoverImage(null)).toBeUndefined();
    expect(normalizeBundleCoverImage(undefined)).toBeUndefined();
  });
});

describe('isAllowedBundleImageFilename', () => {
  it('accepte jpeg/png/webp uniquement', () => {
    expect(isAllowedBundleImageFilename('cover.jpg')).toBe(true);
    expect(isAllowedBundleImageFilename('cover.JPEG')).toBe(true);
    expect(isAllowedBundleImageFilename('cover.png')).toBe(true);
    expect(isAllowedBundleImageFilename('cover.webp')).toBe(true);
    expect(isAllowedBundleImageFilename('cover.gif')).toBe(false);
    expect(isAllowedBundleImageFilename('cover')).toBe(false);
  });
});
