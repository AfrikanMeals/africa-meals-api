import {
  distanceFallbackTravelMinutes,
  formatEtaMinutesLabel,
  predictDeliveryEta,
} from './eta-engine.util';

describe('eta-engine.util', () => {
  it('fallback distance legacy', () => {
    expect(distanceFallbackTravelMinutes(2)).toBe(18);
    expect(formatEtaMinutesLabel(18)).toBe('18 min');
  });

  it('route + prep → ETA et retards', () => {
    const p = predictDeliveryEta({
      roadDurationSeconds: 600, // 10 min
      restaurantPrepMinutes: 15,
      trafficFactor: 1.2,
      weatherFactor: 1,
      alreadyPickedUp: false,
    });
    expect(p.source).toBe('route');
    expect(p.travelMinutes).toBe(12); // 10 * 1.2
    expect(p.pickupDelayMinutes).toBe(15);
    expect(p.etaMinutes).toBe(27);
    expect(p.deliveryDelayMinutes).toBe(2);
  });

  it('already picked up ignore prep', () => {
    const p = predictDeliveryEta({
      roadDurationSeconds: 300,
      restaurantPrepMinutes: 20,
      alreadyPickedUp: true,
    });
    expect(p.pickupDelayMinutes).toBe(0);
    expect(p.etaMinutes).toBe(5);
  });

  it('hybrid blend road + driver speed', () => {
    const p = predictDeliveryEta({
      roadDurationSeconds: 600,
      distanceKm: 5,
      driverSpeedKmh: 30, // 10 min
      trafficFactor: 1,
    });
    expect(p.source).toBe('hybrid');
    expect(p.travelMinutes).toBe(10);
  });
});
