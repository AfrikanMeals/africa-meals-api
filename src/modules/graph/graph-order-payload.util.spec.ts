import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import type { OrderModel } from '@schemas/order.schema';
import { buildGraphOrderCompletedPayload } from './graph-order-payload.util';
import { shouldEnqueueGraphSync } from '@modules/graphdb-settings/graph-config.util';
import { setGraphRuntimeFlagOverrides } from '@modules/graphdb-settings/graph-config.util';

describe('buildGraphOrderCompletedPayload', () => {
  it('builds payload from order line items', () => {
    const order = {
      _id: '507f1f77bcf86cd799439011',
      user: '507f1f77bcf86cd799439012',
      store: '507f1f77bcf86cd799439013',
      storeRegionCode: 'cm',
      totalPrice: 20,
      currency: 'XAF',
      items: [
        {
          entityId: '507f1f77bcf86cd799439014',
          itemType: CartItemTypeEnum.PRODUCT,
          quantity: 2,
          price: 8,
          label: 'Plat',
        },
      ],
    } as unknown as OrderModel;

    const payload = buildGraphOrderCompletedPayload(order);
    expect(payload).toMatchObject({
      userId: '507f1f77bcf86cd799439012',
      storeId: '507f1f77bcf86cd799439013',
      region: 'CM',
      currency: 'XAF',
      totalSpent: 20,
    });
    expect(payload?.items[0]).toMatchObject({
      itemType: 'product',
      quantity: 2,
    });
  });
});

describe('shouldEnqueueGraphSync gate', () => {
  afterEach(() => setGraphRuntimeFlagOverrides(null));

  it('is no-op when sync off', () => {
    expect(shouldEnqueueGraphSync()).toBe(false);
  });

  it('is true when neo4j + sync on', () => {
    setGraphRuntimeFlagOverrides({
      neo4jEnabled: true,
      recoGraphEnabled: false,
      graphSyncEnabled: true,
    });
    expect(shouldEnqueueGraphSync()).toBe(true);
  });
});
