import { Types } from 'mongoose';
import {
  buildDeliveryCancelledHistoryMongoFilter,
  buildDeliveryPendingOrdersMongoFilter,
} from './delivery-pending-orders-query.util';

describe('buildDeliveryPendingOrdersMongoFilter', () => {
  it('returns unassigned + statuses without region when agent region missing', () => {
    const f = buildDeliveryPendingOrdersMongoFilter({});
    expect(f.shouldShip).toBe(true);
    // Claim / file uniquement après mark-ready (approved).
    expect(f.status).toEqual({
      $in: ['approved'],
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

describe('buildDeliveryCancelledHistoryMongoFilter', () => {
  const agentId = new Types.ObjectId();

  it('includes assignee + unassignedFrom without region pool when region missing', () => {
    const f = buildDeliveryCancelledHistoryMongoFilter({ agentId });
    expect(f.shouldShip).toBe(true);
    expect(f.status).toBe('cancelled');
    expect(f.courierAbandonNoPayout).toEqual({ $ne: true });
    const or = f.$or as unknown[];
    expect(or).toHaveLength(1);
    expect(JSON.stringify(or[0])).toContain('assignedDeliveryUser');
    expect(JSON.stringify(or[0])).toContain('deliveryUnassignedFromUser');
  });

  it('adds region claimable-cancel pool when agent region set', () => {
    const f = buildDeliveryCancelledHistoryMongoFilter({
      agentId,
      agentRegionCode: 'cm',
    });
    const or = f.$or as unknown[];
    expect(or.length).toBe(2);
    const json = JSON.stringify(f);
    expect(json).toContain('"storeRegionCode":"CM"');
    expect(json).toContain('"taxCountryCode":"CM"');
  });
});
