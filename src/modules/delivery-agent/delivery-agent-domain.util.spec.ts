import {
  resolveDeliveryAgentPresence,
  AGENT_LOCATION_EMIT_THROTTLE_MS,
  pendingOrderMatchesAgentOperatingRegion,
  pendingOrderWithinMaxDeliveryRadius,
  pendingOrderWithinAgentToStoreRadius,
} from './delivery-agent-domain.util';

describe('delivery-agent-domain.util', () => {
  it('resolveDeliveryAgentPresence maps availability and active orders', () => {
    expect(resolveDeliveryAgentPresence('hors_ligne', 0)).toBe('hors_ligne');
    expect(resolveDeliveryAgentPresence('disponible', 2)).toBe('en_livraison');
    expect(resolveDeliveryAgentPresence('disponible', 0)).toBe('disponible');
  });

  it('throttle aligns with mobile GPS interval (~12s)', () => {
    expect(AGENT_LOCATION_EMIT_THROTTLE_MS).toBe(10_000);
    expect(AGENT_LOCATION_EMIT_THROTTLE_MS).toBeLessThanOrEqual(12_000);
  });

  it('pendingOrderWithinMaxDeliveryRadius respects admin max km', () => {
    expect(pendingOrderWithinMaxDeliveryRadius(14.9, 15)).toBe(true);
    expect(pendingOrderWithinMaxDeliveryRadius(15, 15)).toBe(true);
    expect(pendingOrderWithinMaxDeliveryRadius(15.01, 15)).toBe(false);
    expect(pendingOrderWithinMaxDeliveryRadius(null, 15)).toBe(false);
  });

  it('pendingOrderMatchesAgentOperatingRegion blocks cross-region orders', () => {
    expect(pendingOrderMatchesAgentOperatingRegion('CA', 'CA')).toBe(true);
    expect(pendingOrderMatchesAgentOperatingRegion('CA', 'CM')).toBe(false);
    expect(pendingOrderMatchesAgentOperatingRegion(null, 'CM')).toBe(true);
    expect(pendingOrderMatchesAgentOperatingRegion('CA', null)).toBe(true);
  });

  it('pendingOrderWithinAgentToStoreRadius allows unknown agent distance', () => {
    expect(pendingOrderWithinAgentToStoreRadius(null, 15)).toBe(true);
    expect(pendingOrderWithinAgentToStoreRadius(12, 15)).toBe(true);
    expect(pendingOrderWithinAgentToStoreRadius(9000, 15)).toBe(false);
  });
});
