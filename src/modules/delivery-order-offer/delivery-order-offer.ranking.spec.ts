import {
  isAgentAvailableForOffer,
  parseOfferTimeoutSec,
  rankDeliveryOfferCandidates,
  type DeliveryOfferCandidateInput,
} from './delivery-order-offer.ranking';

describe('delivery-order-offer.ranking', () => {
  const store: [number, number] = [11.5, 3.85]; // lng, lat

  const base = (
    partial: Partial<DeliveryOfferCandidateInput> & { agentUserId: string },
  ): DeliveryOfferCandidateInput => ({
    dashboardAvailability: 'disponible',
    activeOrderCount: 0,
    maxConcurrentOrders: 2,
    lastLatitude: null,
    lastLongitude: null,
    ...partial,
  });

  it('exclut hors_ligne et capacité pleine', () => {
    expect(
      isAgentAvailableForOffer(
        base({ agentUserId: 'a', dashboardAvailability: 'hors_ligne' }),
      ),
    ).toBe(false);
    expect(
      isAgentAvailableForOffer(
        base({
          agentUserId: 'b',
          activeOrderCount: 2,
          maxConcurrentOrders: 2,
        }),
      ),
    ).toBe(false);
    expect(isAgentAvailableForOffer(base({ agentUserId: 'c' }))).toBe(true);
  });

  it('classe par distance GPS croissante puis sans GPS en fin', () => {
    const ranked = rankDeliveryOfferCandidates(
      [
        base({
          agentUserId: 'far',
          lastLatitude: 3.9,
          lastLongitude: 11.6,
        }),
        base({
          agentUserId: 'near',
          lastLatitude: 3.851,
          lastLongitude: 11.501,
        }),
        base({ agentUserId: 'nogps' }),
        base({
          agentUserId: 'offline',
          dashboardAvailability: 'hors_ligne',
          lastLatitude: 3.85,
          lastLongitude: 11.5,
        }),
      ],
      store,
    );
    expect(ranked.map((r) => r.agentUserId)).toEqual([
      'near',
      'far',
      'nogps',
    ]);
    expect(ranked[0].hasGps).toBe(true);
    expect(ranked[2].hasGps).toBe(false);
    expect(ranked[0].distanceMeters!).toBeLessThan(ranked[1].distanceMeters!);
  });

  it('parse timeout avec défaut 45', () => {
    expect(parseOfferTimeoutSec(undefined)).toBe(45);
    expect(parseOfferTimeoutSec('0')).toBe(45);
    expect(parseOfferTimeoutSec('60')).toBe(60);
    expect(parseOfferTimeoutSec('999')).toBe(300);
  });
});
