import {
  countryCodeFromOrderDeliverySnapshot,
  countryCodeFromUserDefaultAddress,
  resolveOrderOperatingRegionCode,
  resolveStoreTaxCountryCode,
} from './region-tax.util';

describe('region-tax.util', () => {
  it('resolveStoreTaxCountryCode falls back to store phone', () => {
    expect(
      resolveStoreTaxCountryCode({
        phoneNumber: '+237651796157',
        currency: 'XAF',
      }),
    ).toBe('CM');
  });

  it('countryCodeFromOrderDeliverySnapshot reads delivery snapshot', () => {
    expect(
      countryCodeFromOrderDeliverySnapshot({
        deliveryAddressSnapshot: { countryCode: 'CM' },
      }),
    ).toBe('CM');
  });

  it('countryCodeFromUserDefaultAddress picks default address', () => {
    expect(
      countryCodeFromUserDefaultAddress({
        addresses: [
          { countryCode: 'CA' },
          { isDefault: true, countryCode: 'CM' },
        ],
      }),
    ).toBe('CM');
  });

  it('resolveOrderOperatingRegionCode uses delivery snapshot when store region missing', () => {
    expect(
      resolveOrderOperatingRegionCode({
        store: { currency: 'XAF' },
        deliveryAddressSnapshot: { countryCode: 'CM' },
      }),
    ).toBe('CM');
  });

  it('resolveOrderOperatingRegionCode prefers store region when set', () => {
    expect(
      resolveOrderOperatingRegionCode({
        store: { region: 'CA' },
        deliveryAddressSnapshot: { countryCode: 'CM' },
      }),
    ).toBe('CA');
  });
});
