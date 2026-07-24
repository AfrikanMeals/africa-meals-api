import {
  COURIER_NEAR_CUSTOMER_THRESHOLD_METERS,
  courierNearThresholdKm,
  isCourierWithinNearCustomerRadius,
  shouldAttemptCourierNearCustomerNotify,
} from './courier-near-customer.util';

describe('courier-near-customer.util', () => {
  it('seuil produit = 500 m → 0.5 km', () => {
    expect(COURIER_NEAR_CUSTOMER_THRESHOLD_METERS).toBe(500);
    expect(courierNearThresholdKm()).toBe(0.5);
  });

  it('isCourierWithinNearCustomerRadius : dans / hors rayon', () => {
    expect(isCourierWithinNearCustomerRadius(0.4)).toBe(true);
    expect(isCourierWithinNearCustomerRadius(0.5)).toBe(true);
    expect(isCourierWithinNearCustomerRadius(0.51)).toBe(false);
    expect(isCourierWithinNearCustomerRadius(null)).toBe(false);
    expect(isCourierWithinNearCustomerRadius(undefined)).toBe(false);
  });

  it('shouldAttemptCourierNearCustomerNotify : one-shot + skip preuve dépôt', () => {
    expect(
      shouldAttemptCourierNearCustomerNotify({ remainingKm: 0.3 }),
    ).toBe(true);
    expect(
      shouldAttemptCourierNearCustomerNotify({
        remainingKm: 0.3,
        alreadyNotifiedAt: new Date(),
      }),
    ).toBe(false);
    expect(
      shouldAttemptCourierNearCustomerNotify({
        remainingKm: 0.3,
        hasPendingDeliveryProof: true,
      }),
    ).toBe(false);
    expect(
      shouldAttemptCourierNearCustomerNotify({ remainingKm: 2 }),
    ).toBe(false);
  });
});
