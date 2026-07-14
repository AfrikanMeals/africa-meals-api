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

  it('priorise geoDistanceMeters (Redis GEO) sur lastLat/Lng Mongo', () => {
    const ranked = rankDeliveryOfferCandidates(
      [
        base({
          agentUserId: 'mongo-near',
          lastLatitude: 3.851,
          lastLongitude: 11.501,
          geoDistanceMeters: 5000,
        }),
        base({
          agentUserId: 'geo-near',
          lastLatitude: 3.9,
          lastLongitude: 11.6,
          geoDistanceMeters: 200,
        }),
      ],
      store,
    );
    expect(ranked.map((r) => r.agentUserId)).toEqual([
      'geo-near',
      'mongo-near',
    ]);
    expect(ranked[0].distanceMeters).toBe(200);
    expect(ranked[1].distanceMeters).toBe(5000);
  });

  it('priorise charge + route faible même si légèrement plus loin', () => {
    const ranked = rankDeliveryOfferCandidates(
      [
        base({
          agentUserId: 'busy-near',
          lastLatitude: 3.851,
          lastLongitude: 11.501,
          activeOrderCount: 1,
          maxConcurrentOrders: 2,
          routeRemainingSeconds: 2400,
          predictedDelayMinutes: 20,
        }),
        base({
          agentUserId: 'free-farther',
          lastLatitude: 3.86,
          lastLongitude: 11.51,
          activeOrderCount: 0,
          maxConcurrentOrders: 2,
          routeRemainingSeconds: 0,
          predictedDelayMinutes: 2,
        }),
      ],
      store,
    );
    expect(ranked[0]!.agentUserId).toBe('free-farther');
    expect(ranked[0]!.dispatchCost).toBeLessThan(ranked[1]!.dispatchCost);
  });

  it('parse timeout avec défaut 45', () => {
    expect(parseOfferTimeoutSec(undefined)).toBe(45);
    expect(parseOfferTimeoutSec('0')).toBe(45);
    expect(parseOfferTimeoutSec('60')).toBe(60);
    expect(parseOfferTimeoutSec('999')).toBe(300);
  });
});
