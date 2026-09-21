import {
  buildDeliveryOfferDisplayFields,
  computeOfferDriverEarning,
  formatOfferAddressLine,
} from './delivery-order-offer-display.util';

describe('computeOfferDriverEarning', () => {
  it('retenue fixed', () => {
    expect(
      computeOfferDriverEarning(10, {
        deliveryWithheldFeeMode: 'fixed',
        deliveryWithheldFeeFixed: 2,
      }),
    ).toEqual({ driverEarning: 8, platformWithheld: 2 });
  });

  it('retenue percent', () => {
    expect(
      computeOfferDriverEarning(20, {
        deliveryWithheldFeeMode: 'percent',
        deliveryWithheldFeePercent: 20,
      }),
    ).toEqual({ driverEarning: 16, platformWithheld: 4 });
  });

  it('sans settings → earning = shipping', () => {
    expect(computeOfferDriverEarning(12.5, null)).toEqual({
      driverEarning: 12.5,
      platformWithheld: 0,
    });
  });
});

describe('formatOfferAddressLine', () => {
  it('assemble rue + ville + pays', () => {
    expect(
      formatOfferAddressLine({
        address: '1288 Rue Saint-Antoine O',
        city: 'Montreal',
        zipCode: 'H3C 1B9',
        countryCode: 'CA',
      }),
    ).toBe('1288 Rue Saint-Antoine O, Montreal H3C 1B9, Canada');
  });

  it('vide si snap absent', () => {
    expect(formatOfferAddressLine(null)).toBe('');
  });
});

describe('buildDeliveryOfferDisplayFields', () => {
  it('extrait currency earning adresses', () => {
    const fields = buildDeliveryOfferDisplayFields({
      order: {
        currency: 'xaf',
        shippingPrice: 1000,
        deliveryAddressSnapshot: {
          address: 'Drop St',
          city: 'Douala',
          zip_code: '000',
          country: 'Cameroon',
        },
      },
      store: {
        currency: 'XAF',
        address: { address: 'Boutique Ave', city: 'Douala', zipCode: '111' },
      },
      withheldSettings: {
        deliveryWithheldFeeMode: 'fixed',
        deliveryWithheldFeeFixed: 100,
      },
    });
    expect(fields.currency).toBe('XAF');
    expect(fields.shippingPrice).toBe(1000);
    expect(fields.driverEarning).toBe(900);
    expect(fields.storeAddress).toContain('Boutique Ave');
    expect(fields.dropoffAddress).toContain('Drop St');
  });
});
