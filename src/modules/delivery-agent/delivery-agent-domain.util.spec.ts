import {
  resolveDeliveryAgentPresence,
  AGENT_LOCATION_EMIT_THROTTLE_MS,
  pendingOrderMatchesAgentOperatingRegion,
  pendingOrderWithinMaxDeliveryRadius,
  pendingOrderWithinAgentToStoreRadius,
  resolveAgentOperatingRegionCode,
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
    // assign-self doit peupler store.address.location ; sinon distanceKm=null → rejet
    // (régression : populate countryCode seul → 400 order_outside_delivery_radius).
    expect(pendingOrderWithinMaxDeliveryRadius(null, 15)).toBe(false);
  });

  it('pendingOrderMatchesAgentOperatingRegion blocks cross-region orders', () => {
    expect(pendingOrderMatchesAgentOperatingRegion('CA', 'CA')).toBe(true);
    expect(pendingOrderMatchesAgentOperatingRegion('CA', 'CM')).toBe(false);
    expect(pendingOrderMatchesAgentOperatingRegion(null, 'CM')).toBe(true);
    expect(pendingOrderMatchesAgentOperatingRegion('CA', null)).toBe(true);
  });

  it('resolveAgentOperatingRegionCode prefers application region over user appCountryCode', () => {
    // Régression assign-self : sans app.region chargé, user.appCountryCode=CA
    // faisait rejeter une course CM alors que le dossier livreur est CM.
    expect(resolveAgentOperatingRegionCode('CM', 'CA')).toBe('CM');
    expect(resolveAgentOperatingRegionCode(null, 'CM')).toBe('CM');
    expect(resolveAgentOperatingRegionCode('CM', null)).toBe('CM');
    expect(resolveAgentOperatingRegionCode(undefined, undefined)).toBeUndefined();
  });

  it('pendingOrderWithinAgentToStoreRadius allows unknown agent distance', () => {
    expect(pendingOrderWithinAgentToStoreRadius(null, 15)).toBe(true);
    expect(pendingOrderWithinAgentToStoreRadius(12, 15)).toBe(true);
    expect(pendingOrderWithinAgentToStoreRadius(9000, 15)).toBe(false);
  });
});
