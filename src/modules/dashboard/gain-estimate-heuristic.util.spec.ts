import { buildGainEstimateFromRaw } from './gain-estimate-build.util';
import { buildGainEstimateHeuristicAi } from './gain-estimate-heuristic.util';
import type { GainEstimateRawInputs } from './gain-estimate.types';

function lossPayload() {
  const inputs: GainEstimateRawInputs = {
    orderCommissionCad: 10,
    orderPaymentFeeCad: 0,
    vendorSubscriptionsCad: 0,
    partnerSubscriptionsCad: 0,
    adCreditCad: 0,
    smsPaidCad: 0,
    smsPendingCad: 0,
    payoutFeesCad: 0,
    payoutFeesEstimated: true,
    stripeProcessingCad: 80,
    planSnapshot: {
      vendorActiveCount: 3,
      partnerActiveCount: 0,
      vendorAvgPricePaidCad: 5,
      partnerAvgPricePaidCad: 0,
      vendorCatalogAvgMonthlyCad: 40,
      partnerCatalogAvgMonthlyCad: 0,
    },
    feeConfigSnapshot: {
      orderCommissionMode: 'percent',
      orderCommissionFixed: 0,
      orderCommissionPercent: 2,
      orderPaymentFeeMode: 'fixed',
      orderPaymentFeeFixed: 0,
      orderPaymentFeePercent: 0,
      payoutFeeMode: 'percent',
      payoutFeeFixed: 0,
      payoutFeePercent: 1,
    },
    locale: 'fr',
  };
  return buildGainEstimateFromRaw(inputs, {
    periodKey: '30d',
    from: '2026-06-29',
    to: '2026-07-28',
    timezone: 'America/Toronto',
  });
}

describe('gain-estimate-heuristic.util', () => {
  it('perte → suggestions take rate + free tiers (FR)', () => {
    const ai = buildGainEstimateHeuristicAi(lossPayload(), 'fr');
    expect(ai.source).toBe('heuristic');
    expect(ai.summary.toLowerCase()).toContain('perte');
    expect(ai.suggestions.length).toBeGreaterThan(0);
    expect(
      ai.suggestions.some((s) => /commission|take rate|frais/i.test(s)),
    ).toBe(true);
  });

  it('perte EN → summary loss', () => {
    const ai = buildGainEstimateHeuristicAi(lossPayload(), 'en');
    expect(ai.summary.toLowerCase()).toContain('loss');
  });
});
