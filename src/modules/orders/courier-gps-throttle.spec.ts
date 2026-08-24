import {
  CourierGpsThrottle,
  roundCourierCoordinate,
} from './courier-gps-throttle';

describe('CourierGpsThrottle', () => {
  it('allows first publish per agent/order', () => {
    const throttle = new CourierGpsThrottle({
      throttleMs: 3000,
      coordPrecision: 4,
    });
    expect(
      throttle.shouldPublish('agent1', 'order1', 48.8566, 2.3522),
    ).toBe(true);
  });

  it('blocks duplicate within throttle window', () => {
    const throttle = new CourierGpsThrottle({
      throttleMs: 5000,
      coordPrecision: 4,
    });
    expect(
      throttle.shouldPublish('agent1', 'order1', 48.8566, 2.3522),
    ).toBe(true);
    expect(
      throttle.shouldPublish('agent1', 'order1', 48.857, 2.353),
    ).toBe(false);
  });

  it('allows different orders for same agent', () => {
    const throttle = new CourierGpsThrottle({
      throttleMs: 5000,
      coordPrecision: 4,
    });
    expect(
      throttle.shouldPublish('agent1', 'order1', 48.8566, 2.3522),
    ).toBe(true);
    expect(
      throttle.shouldPublish('agent1', 'order2', 48.8566, 2.3522),
    ).toBe(true);
  });

  it('setThrottleMs shortens the window to match admin active ping', () => {
    const throttle = new CourierGpsThrottle({
      throttleMs: 5000,
      coordPrecision: 4,
    });
    expect(throttle.shouldPublish('a', 'o', 1, 2)).toBe(true);
    throttle.setThrottleMs(1000);
    expect(throttle.throttleMs()).toBe(1000);
  });
});

describe('roundCourierCoordinate', () => {
  it('rounds to configured precision', () => {
    expect(roundCourierCoordinate(48.8566111, 4)).toBe(48.8566);
  });
});
