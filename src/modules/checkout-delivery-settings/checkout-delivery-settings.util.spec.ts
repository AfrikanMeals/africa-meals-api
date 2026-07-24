import {
  normalizeHideDeliveryWhenNoCourierAvailable,
  toCheckoutDeliverySettingsResponse,
} from './checkout-delivery-settings.util';

describe('checkout-delivery-settings.util', () => {
  it('n’active le masquage que pour true strict', () => {
    expect(normalizeHideDeliveryWhenNoCourierAvailable(true)).toBe(true);
    expect(normalizeHideDeliveryWhenNoCourierAvailable(false)).toBe(false);
    expect(normalizeHideDeliveryWhenNoCourierAvailable(undefined)).toBe(false);
    expect(normalizeHideDeliveryWhenNoCourierAvailable(null)).toBe(false);
    expect(normalizeHideDeliveryWhenNoCourierAvailable('true')).toBe(false);
    expect(normalizeHideDeliveryWhenNoCourierAvailable(1)).toBe(false);
  });

  it('sérialise la réponse publique avec updatedAt ISO', () => {
    const at = new Date('2026-07-24T12:00:00.000Z');
    expect(
      toCheckoutDeliverySettingsResponse({
        hideDeliveryWhenNoCourierAvailable: true,
        updatedAt: at,
      }),
    ).toEqual({
      hideDeliveryWhenNoCourierAvailable: true,
      updatedAt: '2026-07-24T12:00:00.000Z',
    });
    expect(
      toCheckoutDeliverySettingsResponse({
        hideDeliveryWhenNoCourierAvailable: undefined,
        updatedAt: null,
      }),
    ).toEqual({
      hideDeliveryWhenNoCourierAvailable: false,
      updatedAt: null,
    });
  });
});
