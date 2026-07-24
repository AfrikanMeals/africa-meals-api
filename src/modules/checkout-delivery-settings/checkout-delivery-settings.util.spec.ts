import {
  buildCheckoutDeliverySettingsUpsertUpdate,
  CHECKOUT_DELIVERY_SETTINGS_KEY,
  DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
  normalizeCourierNearCustomerRadiusMeters,
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

  it('normalise le rayon livreur proche (défaut 500, bornes 50–5000)', () => {
    expect(normalizeCourierNearCustomerRadiusMeters(undefined)).toBe(
      DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
    );
    expect(normalizeCourierNearCustomerRadiusMeters(500)).toBe(500);
    expect(normalizeCourierNearCustomerRadiusMeters(750)).toBe(750);
    expect(normalizeCourierNearCustomerRadiusMeters('300')).toBe(300);
    expect(normalizeCourierNearCustomerRadiusMeters(49)).toBe(
      DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
    );
    expect(normalizeCourierNearCustomerRadiusMeters(5001)).toBe(
      DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
    );
    expect(normalizeCourierNearCustomerRadiusMeters(NaN)).toBe(
      DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
    );
  });

  it('sérialise la réponse publique avec updatedAt ISO + rayon', () => {
    const at = new Date('2026-07-24T12:00:00.000Z');
    expect(
      toCheckoutDeliverySettingsResponse({
        hideDeliveryWhenNoCourierAvailable: true,
        courierNearCustomerRadiusMeters: 800,
        updatedAt: at,
      }),
    ).toEqual({
      hideDeliveryWhenNoCourierAvailable: true,
      courierNearCustomerRadiusMeters: 800,
      updatedAt: '2026-07-24T12:00:00.000Z',
    });
    expect(
      toCheckoutDeliverySettingsResponse({
        hideDeliveryWhenNoCourierAvailable: undefined,
        updatedAt: null,
      }),
    ).toEqual({
      hideDeliveryWhenNoCourierAvailable: false,
      courierNearCustomerRadiusMeters: DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
      updatedAt: null,
    });
  });

  // Anti-régression PUT 500 : paths $set / $setOnInsert disjoints.
  it('build upsert sans path commun entre $set et $setOnInsert', () => {
    const update = buildCheckoutDeliverySettingsUpsertUpdate({
      hideDeliveryWhenNoCourierAvailable: true,
      courierNearCustomerRadiusMeters: 600,
    });
    expect(update.$setOnInsert).toEqual({
      key: CHECKOUT_DELIVERY_SETTINGS_KEY,
    });
    expect(update.$set).toEqual({
      hideDeliveryWhenNoCourierAvailable: true,
      courierNearCustomerRadiusMeters: 600,
    });
    const setPaths = Object.keys(update.$set);
    const insertPaths = Object.keys(update.$setOnInsert);
    expect(setPaths.some((p) => insertPaths.includes(p))).toBe(false);
  });
});
