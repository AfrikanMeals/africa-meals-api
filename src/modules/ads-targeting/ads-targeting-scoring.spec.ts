import { computeAdsTargetingScore } from './ads-targeting-scoring';
import {
  computeDeliveryConversionBoost,
  computePlacementPerformanceBoost,
  computePositionBoost,
  placementMatchScore,
} from './ads-targeting-placement.util';

describe('computeAdsTargetingScore', () => {
  it('applique les poids avec critères placement', () => {
    const score = computeAdsTargetingScore({
      interestMatch: 0.8,
      recencyBoost: 0.4,
      engagementScore: 0.6,
      conversionProbability: 0.5,
      placementMatch: 1,
      positionBoost: 0.9,
      deliveryConversionBoost: 0.85,
      placementPerformance: 0.7,
    });
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('borne les valeurs hors plage', () => {
    const score = computeAdsTargetingScore({
      interestMatch: 5,
      recencyBoost: -2,
      engagementScore: Number.NaN,
      conversionProbability: 1.2,
      placementMatch: -1,
      positionBoost: 2,
      deliveryConversionBoost: 99,
      placementPerformance: -5,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('retourne 0 pour un profil vide', () => {
    const score = computeAdsTargetingScore({
      interestMatch: 0,
      recencyBoost: 0,
      engagementScore: 0,
      conversionProbability: 0,
      placementMatch: 0,
      positionBoost: 0,
      deliveryConversionBoost: 0,
      placementPerformance: 0,
    });
    expect(score).toBe(0);
  });
});

describe('placement scoring helpers', () => {
  it('favorise PRODUCT et slot 0 pour conversion', () => {
    const slot0 = computeDeliveryConversionBoost({
      actionType: 'PRODUCT',
      hasProductItems: true,
      segment: 'high_intent_buyer',
      conversionProbability: 0.4,
      requestSlot: 0,
    });
    const slot3 = computeDeliveryConversionBoost({
      actionType: 'EMAIL',
      hasProductItems: false,
      segment: 'new_user',
      conversionProbability: 0.05,
      requestSlot: 3,
    });
    expect(slot0).toBeGreaterThan(slot3);
  });

  it('position boost suit priority et preferred slot', () => {
    const perfect = computePositionBoost({
      priority: 5,
      preferredSlot: 0,
      requestSlot: 0,
    });
    const weak = computePositionBoost({
      priority: 90,
      preferredSlot: 0,
      requestSlot: 3,
    });
    expect(perfect).toBeGreaterThan(weak);
  });

  it('placement match respecte les règles', () => {
    expect(
      placementMatchScore(
        { placements: ['home_feed:slot_0'] },
        'home_feed:slot_0',
      ),
    ).toBe(1);
    expect(
      placementMatchScore({ placements: ['campaign_slider'] }, 'home_feed'),
    ).toBe(0);
  });

  it('placement performance monte avec le CTR', () => {
    const high = computePlacementPerformanceBoost({
      impressions: 100,
      clicks: 12,
      purchases: 2,
    });
    const low = computePlacementPerformanceBoost({
      impressions: 100,
      clicks: 0,
      purchases: 0,
    });
    expect(high).toBeGreaterThan(low);
  });
});
