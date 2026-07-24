import {
  buildCheckoutDeliverySettingsUpsertUpdate,
  CHECKOUT_DELIVERY_SETTINGS_KEY,
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

  // Anti-régression PUT 500 : paths $set / $setOnInsert disjoints.
  it('build upsert sans path commun entre $set et $setOnInsert', () => {
    const update = buildCheckoutDeliverySettingsUpsertUpdate({
      hideDeliveryWhenNoCourierAvailable: true,
    });
    expect(update.$setOnInsert).toEqual({
      key: CHECKOUT_DELIVERY_SETTINGS_KEY,
    });
    expect(update.$set).toEqual({
      hideDeliveryWhenNoCourierAvailable: true,
    });
    const setPaths = Object.keys(update.$set);
    const insertPaths = Object.keys(update.$setOnInsert);
    expect(setPaths.some((p) => insertPaths.includes(p))).toBe(false);
  });
});
