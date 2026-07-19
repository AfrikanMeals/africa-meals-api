import { StoreDeliveryAssignmentModeEnum } from '@schemas/store.schema';
import { decideCheckoutCourierAvailability } from './checkout-courier-availability.decision';

const STORE_ID = '507f1f77bcf86cd799439011';

describe('decideCheckoutCourierAvailability', () => {
  it('masque Livraison si shipping boutique désactivé', () => {
    expect(
      decideCheckoutCourierAvailability({
        storeId: STORE_ID,
        supportsShipping: false,
        managed: false,
        selfDeliveryRequired: false,
        assignmentMode: StoreDeliveryAssignmentModeEnum.AUTO,
        fleetHasAssignable: false,
        platformHasAssignable: true,
      }),
    ).toMatchObject({
      state: 'unavailable',
      reason: 'store_shipping_disabled',
    });
  });

  it('priorise un membre flotte assignable', () => {
    expect(
      decideCheckoutCourierAvailability({
        storeId: STORE_ID,
        supportsShipping: true,
        managed: true,
        selfDeliveryRequired: true,
        assignmentMode: StoreDeliveryAssignmentModeEnum.AUTO,
        fleetHasAssignable: true,
        platformHasAssignable: false,
      }),
    ).toEqual({
      storeId: STORE_ID,
      state: 'available',
      strategy: 'store_fleet',
    });
  });

  it('ouvre Livraison via self-shipping même sans livreur en ligne', () => {
    // Fix: plan livraison autonome — le vendeur peut s’assigner la course.
    expect(
      decideCheckoutCourierAvailability({
        storeId: STORE_ID,
        supportsShipping: true,
        managed: true,
        selfDeliveryRequired: true,
        assignmentMode: StoreDeliveryAssignmentModeEnum.MANUAL,
        fleetHasAssignable: false,
        platformHasAssignable: false,
      }),
    ).toEqual({
      storeId: STORE_ID,
      state: 'available',
      strategy: 'store_fleet',
      reason: 'vendor_self_delivery',
    });
  });

  it('ouvre Livraison si flotte gérée sans self-shipping plan', () => {
    expect(
      decideCheckoutCourierAvailability({
        storeId: STORE_ID,
        supportsShipping: true,
        managed: true,
        selfDeliveryRequired: false,
        assignmentMode: StoreDeliveryAssignmentModeEnum.AUTO,
        fleetHasAssignable: false,
        platformHasAssignable: true,
      }),
    ).toEqual({
      storeId: STORE_ID,
      state: 'available',
      strategy: 'store_fleet',
      reason: 'vendor_managed_delivery',
    });
  });

  it('utilise le pool plateforme pour une boutique non gérée', () => {
    expect(
      decideCheckoutCourierAvailability({
        storeId: STORE_ID,
        supportsShipping: true,
        managed: false,
        selfDeliveryRequired: false,
        assignmentMode: StoreDeliveryAssignmentModeEnum.AUTO,
        fleetHasAssignable: false,
        platformHasAssignable: true,
      }),
    ).toEqual({
      storeId: STORE_ID,
      state: 'available',
      strategy: 'platform',
    });
  });

  it('masque Livraison sans pool plateforme ni self-shipping', () => {
    expect(
      decideCheckoutCourierAvailability({
        storeId: STORE_ID,
        supportsShipping: true,
        managed: false,
        selfDeliveryRequired: false,
        assignmentMode: StoreDeliveryAssignmentModeEnum.AUTO,
        fleetHasAssignable: false,
        platformHasAssignable: false,
      }),
    ).toMatchObject({
      state: 'unavailable',
      strategy: 'platform',
      reason: 'no_online_courier',
    });
  });

  it('reste unknown si géoloc boutique absente (fail-open mobile)', () => {
    expect(
      decideCheckoutCourierAvailability({
        storeId: STORE_ID,
        supportsShipping: true,
        managed: false,
        selfDeliveryRequired: false,
        assignmentMode: StoreDeliveryAssignmentModeEnum.AUTO,
        fleetHasAssignable: false,
        platformHasAssignable: null,
      }),
    ).toMatchObject({
      state: 'unknown',
      reason: 'store_location_unavailable',
    });
  });
});
