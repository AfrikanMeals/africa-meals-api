import {
  applyDispatchEnrichment,
  predictOfferDelayMinutes,
} from './delivery-order-offer.dispatch-enrich';
import type { DeliveryOfferCandidateInput } from './delivery-order-offer.ranking';

describe('delivery-order-offer.dispatch-enrich', () => {
  const store: [number, number] = [11.5, 3.85];
  const delivery: [number, number] = [11.52, 3.86];

  it('predictOfferDelayMinutes augmente avec la distance', () => {
    const near = predictOfferDelayMinutes({
      storeLngLat: store,
      deliveryLngLat: delivery,
      distanceToStoreMeters: 200,
      trafficFactor: 1,
    });
    const far = predictOfferDelayMinutes({
      storeLngLat: store,
      deliveryLngLat: delivery,
      distanceToStoreMeters: 12_000,
      trafficFactor: 1,
    });
    expect(far).toBeGreaterThan(near);
  });

  it('applyDispatchEnrichment remplit route + délai', () => {
    const inputs: DeliveryOfferCandidateInput[] = [
      {
        agentUserId: 'a1',
        activeOrderCount: 1,
        maxConcurrentOrders: 2,
        geoDistanceMeters: 500,
        lastLatitude: 3.85,
        lastLongitude: 11.5,
      },
    ];
    applyDispatchEnrichment(inputs, {
      routeByAgent: new Map([['a1', 900]]),
      storeLngLat: store,
      deliveryLngLat: delivery,
      trafficFactor: 1.2,
    });
    expect(inputs[0]!.routeRemainingSeconds).toBe(900);
    expect(inputs[0]!.predictedDelayMinutes).toBeGreaterThan(0);
  });
});
