import { buildDeliveryPendingOrdersMongoFilter } from './delivery-pending-orders-query.util';

describe('buildDeliveryPendingOrdersMongoFilter', () => {
  it('returns unassigned + statuses without region when agent region missing', () => {
    const f = buildDeliveryPendingOrdersMongoFilter({});
    expect(f.shouldShip).toBe(true);
    expect(f.status).toEqual({
      $in: ['created', 'paied', 'approved'],
    });
    expect(f.$or).toEqual([
      { assignedDeliveryUser: { $exists: false } },
      { assignedDeliveryUser: null },
    ]);
    expect(f.$and).toBeUndefined();
  });

  it('push-down storeRegionCode + taxCountryCode fallback for agent region', () => {
    const f = buildDeliveryPendingOrdersMongoFilter({
      agentRegionCode: 'cm',
    });
    expect(f.shouldShip).toBe(true);
    expect(Array.isArray(f.$and)).toBe(true);
    const json = JSON.stringify(f);
    expect(json).toContain('"storeRegionCode":"CM"');
    expect(json).toContain('"taxCountryCode":"CM"');
  });
});
