import {
  canVendorConfirmCourierStorePickup,
  needsVendorStorePickupConfirmAlert,
  orderIsThirdPartyCourierDelivery,
  shouldSkipVendorStorePickupAlert,
  storeCollectedConfirmedAtIso,
} from './vendor-courier-store-pickup.util';
import { parseStoreCollectedAt } from '@modules/delivery-agent/delivery-agent-store-collected.util';

describe('vendor-courier-store-pickup.util', () => {
  const thirdPartyShipped = {
    shouldShip: true,
    isPickup: false,
    status: 'shipped',
    storeCollectedAt: '2026-08-25T10:00:00.000Z',
    storeCollectedConfirmedAt: null,
    assignedDeliveryUserId: 'agent-1',
    storeOwnerUserId: 'owner-1',
  };

  it('orderIsThirdPartyCourierDelivery', () => {
    expect(
      orderIsThirdPartyCourierDelivery({ shouldShip: true, isPickup: false }),
    ).toBe(true);
    expect(
      orderIsThirdPartyCourierDelivery({ shouldShip: false, isPickup: true }),
    ).toBe(false);
  });

  it('shouldSkipVendorStorePickupAlert — self-delivery vendeur', () => {
    expect(
      shouldSkipVendorStorePickupAlert({
        ...thirdPartyShipped,
        assigneeIsStoreVendor: true,
      }),
    ).toBe(true);
    expect(
      shouldSkipVendorStorePickupAlert({
        ...thirdPartyShipped,
        assignedDeliveryUserId: 'owner-1',
        storeOwnerUserId: 'owner-1',
      }),
    ).toBe(true);
    expect(shouldSkipVendorStorePickupAlert(thirdPartyShipped)).toBe(false);
  });

  it('canVendorConfirmCourierStorePickup', () => {
    expect(canVendorConfirmCourierStorePickup(thirdPartyShipped)).toBe(true);
    expect(
      canVendorConfirmCourierStorePickup({
        ...thirdPartyShipped,
        storeCollectedAt: null,
      }),
    ).toBe(false);
    expect(
      canVendorConfirmCourierStorePickup({
        ...thirdPartyShipped,
        storeCollectedConfirmedAt: '2026-08-25T10:05:00.000Z',
      }),
    ).toBe(false);
    expect(
      canVendorConfirmCourierStorePickup({
        ...thirdPartyShipped,
        assigneeIsStoreVendor: true,
      }),
    ).toBe(false);
  });

  it('needsVendorStorePickupConfirmAlert mirrors can confirm', () => {
    expect(needsVendorStorePickupConfirmAlert(thirdPartyShipped)).toBe(true);
    expect(
      needsVendorStorePickupConfirmAlert({
        ...thirdPartyShipped,
        status: 'approved',
      }),
    ).toBe(false);
  });

  it('storeCollectedConfirmedAtIso', () => {
    expect(storeCollectedConfirmedAtIso(null)).toBeNull();
    expect(
      storeCollectedConfirmedAtIso('2026-08-25T10:05:00.000Z'),
    ).toBe('2026-08-25T10:05:00.000Z');
    expect(
      parseStoreCollectedAt('2026-08-25T10:00:00.000Z')?.toISOString(),
    ).toBe('2026-08-25T10:00:00.000Z');
  });
});
