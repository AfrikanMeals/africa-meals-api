import { resolveGeocodeForwardCountryCode } from './geocode-forward-country.util';

describe('resolveGeocodeForwardCountryCode', () => {
  it('worldwide : ignore le pays compte (Douala hors CA)', () => {
    expect(
      resolveGeocodeForwardCountryCode({
        countryCode: '',
        userAppCountryCode: 'CA',
        worldwide: true,
      }),
    ).toBe('');
  });

  it('worldwide avec country explicite : conserve CM', () => {
    expect(
      resolveGeocodeForwardCountryCode({
        countryCode: 'CM',
        userAppCountryCode: 'CA',
        worldwide: true,
      }),
    ).toBe('CM');
  });

  it('défaut vendeur : repli user puis CA', () => {
    expect(
      resolveGeocodeForwardCountryCode({
        countryCode: '',
        userAppCountryCode: 'CM',
      }),
    ).toBe('CM');
    expect(
      resolveGeocodeForwardCountryCode({
        countryCode: '',
        userAppCountryCode: '',
      }),
    ).toBe('CA');
  });
});
