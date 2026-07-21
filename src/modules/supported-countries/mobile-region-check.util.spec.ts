import { isMobileRegionCheckEnabled } from './mobile-region-check.util';

describe('isMobileRegionCheckEnabled', () => {
  it('défaut activé si absent', () => {
    expect(isMobileRegionCheckEnabled(undefined)).toBe(true);
    expect(isMobileRegionCheckEnabled(null)).toBe(true);
  });

  it('respecte true / false explicites', () => {
    expect(isMobileRegionCheckEnabled(true)).toBe(true);
    expect(isMobileRegionCheckEnabled(false)).toBe(false);
  });
});
