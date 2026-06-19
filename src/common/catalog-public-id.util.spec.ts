import {
  clientPlatformFromRequest,
  resolveMongoIdFromPublicParam,
  shouldApplyCatalogRegionFilter,
} from './catalog-public-id.util';

describe('catalog-public-id.util', () => {
  it('returns raw id when already a valid ObjectId', () => {
    expect(resolveMongoIdFromPublicParam('6a1ac069f79292022ab2a4f4')).toBe(
      '6a1ac069f79292022ab2a4f4',
    );
  });

  it('extracts id from store public slug', () => {
    expect(
      resolveMongoIdFromPublicParam('6a1ac069f79292022ab2a4f4-resto-102'),
    ).toBe('6a1ac069f79292022ab2a4f4');
  });

  it('rejects invalid slug without 24-char hex prefix', () => {
    expect(
      resolveMongoIdFromPublicParam('6a1ac069f9292022ab2a4f4-resto-102'),
    ).toBeNull();
  });

  it('reads x-client-platform header', () => {
    expect(
      clientPlatformFromRequest({ headers: { 'x-client-platform': 'Web' } }),
    ).toBe('web');
  });

  it('never applies catalog region filter on web', () => {
    expect(shouldApplyCatalogRegionFilter('web', undefined)).toBe(false);
    expect(shouldApplyCatalogRegionFilter('web', 'CM')).toBe(false);
    expect(shouldApplyCatalogRegionFilter('web', '')).toBe(false);
  });

  it('applies catalog region filter for non-web clients', () => {
    expect(shouldApplyCatalogRegionFilter('ios', undefined)).toBe(true);
    expect(shouldApplyCatalogRegionFilter(undefined, undefined)).toBe(true);
  });
});
