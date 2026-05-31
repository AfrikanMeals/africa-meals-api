import { computeAdsTargetingScore } from './ads-targeting-scoring';

describe('computeAdsTargetingScore', () => {
  it('applique les poids attendus', () => {
    const score = computeAdsTargetingScore({
      interestMatch: 0.8,
      recencyBoost: 0.4,
      engagementScore: 0.6,
      conversionProbability: 0.5,
    });
    expect(score).toBe(0.65);
  });

  it('borne les valeurs hors plage', () => {
    const score = computeAdsTargetingScore({
      interestMatch: 5,
      recencyBoost: -2,
      engagementScore: Number.NaN,
      conversionProbability: 1.2,
    });
    expect(score).toBe(0.6);
  });

  it('retourne 0 pour un profil vide', () => {
    const score = computeAdsTargetingScore({
      interestMatch: 0,
      recencyBoost: 0,
      engagementScore: 0,
      conversionProbability: 0,
    });
    expect(score).toBe(0);
  });
});
