import {
  normalizePartnerOperatingRegionCode,
  pickPartnerPricingRegionCode,
} from './partner-pricing-region.util';

describe('partner-pricing-region.util', () => {
  describe('normalizePartnerOperatingRegionCode', () => {
    it('normalise ISO2', () => {
      expect(normalizePartnerOperatingRegionCode(' cm ')).toBe('CM');
    });

    it('refuse invalide', () => {
      expect(normalizePartnerOperatingRegionCode('')).toBeNull();
      expect(normalizePartnerOperatingRegionCode('CAM')).toBeNull();
      expect(normalizePartnerOperatingRegionCode(null)).toBeNull();
    });
  });

  describe('pickPartnerPricingRegionCode', () => {
    it('priorise appCountryCode (CM) sur candidature CA', () => {
      expect(
        pickPartnerPricingRegionCode({
          appCountryCode: 'CM',
          partnerOperatingRegion: 'CA',
          requestedRegion: 'CA',
        }),
      ).toBe('CM');
    });

    it('repli candidature si profil sans pays', () => {
      expect(
        pickPartnerPricingRegionCode({
          appCountryCode: null,
          partnerOperatingRegion: 'CM',
          requestedRegion: 'CA',
        }),
      ).toBe('CM');
    });

    it('repli sur hint si Partner sans région', () => {
      expect(
        pickPartnerPricingRegionCode({
          appCountryCode: '',
          partnerOperatingRegion: null,
          requestedRegion: 'ca',
        }),
      ).toBe('CA');
    });

    it('null si aucune source valide', () => {
      expect(
        pickPartnerPricingRegionCode({
          appCountryCode: null,
          partnerOperatingRegion: '',
          requestedRegion: 'X',
        }),
      ).toBeNull();
    });
  });
});
