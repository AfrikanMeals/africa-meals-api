import {
  buildGainEstimateFromRaw,
  resolveGainEstimateVerdict,
  roundCad,
} from './gain-estimate-build.util';
import type { GainEstimateRawInputs } from './gain-estimate.types';

const baseInputs = (): GainEstimateRawInputs => ({
  orderCommissionCad: 100,
  orderPaymentFeeCad: 20,
  vendorSubscriptionsCad: 50,
  partnerSubscriptionsCad: 30,
  adCreditCad: 40,
  smsPaidCad: 10,
  smsPendingCad: 5,
  payoutFeesCad: 8,
  payoutFeesEstimated: true,
  stripeProcessingCad: 60,
  planSnapshot: {
    vendorActiveCount: 2,
    partnerActiveCount: 1,
    vendorAvgPricePaidCad: 25,
    partnerAvgPricePaidCad: 15,
    vendorCatalogAvgMonthlyCad: 40,
    partnerCatalogAvgMonthlyCad: 20,
  },
  feeConfigSnapshot: {
    orderCommissionMode: 'percent',
    orderCommissionFixed: 0,
    orderCommissionPercent: 10,
    orderPaymentFeeMode: 'fixed',
    orderPaymentFeeFixed: 0.3,
    orderPaymentFeePercent: 0,
    payoutFeeMode: 'percent',
    payoutFeeFixed: 0,
    payoutFeePercent: 1,
  },
  locale: 'fr',
});

describe('gain-estimate-build.util', () => {
  it('roundCad arrondit à 2 décimales', () => {
    expect(roundCad(1.239)).toBe(1.24);
    expect(roundCad(Number.NaN)).toBe(0);
  });

  it('resolveGainEstimateVerdict — profit / loss / break_even', () => {
    expect(resolveGainEstimateVerdict(10)).toBe('profit');
    expect(resolveGainEstimateVerdict(-10)).toBe('loss');
    expect(resolveGainEstimateVerdict(0.5)).toBe('break_even');
    expect(resolveGainEstimateVerdict(-0.4)).toBe('break_even');
  });

  it('buildGainEstimateFromRaw calcule revenus − coûts Stripe', () => {
    const payload = buildGainEstimateFromRaw(baseInputs(), {
      periodKey: '30d',
      from: '2026-06-29',
      to: '2026-07-28',
      timezone: 'America/Toronto',
    });
    // 100+20+50+30+40+10+5+8 = 263 revenue ; cost 60 ; net 203
    expect(payload.totals.revenueCad).toBe(263);
    expect(payload.totals.costCad).toBe(60);
    expect(payload.totals.netCad).toBe(203);
    expect(payload.totals.verdict).toBe('profit');
    expect(payload.breakdown.find((r) => r.key === 'payout_fees')?.estimated).toBe(
      true,
    );
    expect(payload.breakdown.find((r) => r.key === 'stripe_processing')?.side).toBe(
      'cost',
    );
  });

  it('buildGainEstimateFromRaw — perte si Stripe > revenus', () => {
    const inputs = baseInputs();
    inputs.orderCommissionCad = 10;
    inputs.orderPaymentFeeCad = 0;
    inputs.vendorSubscriptionsCad = 0;
    inputs.partnerSubscriptionsCad = 0;
    inputs.adCreditCad = 0;
    inputs.smsPaidCad = 0;
    inputs.smsPendingCad = 0;
    inputs.payoutFeesCad = 0;
    inputs.stripeProcessingCad = 50;
    const payload = buildGainEstimateFromRaw(inputs, {
      periodKey: '7d',
      from: '2026-07-22',
      to: '2026-07-28',
      timezone: 'America/Toronto',
    });
    expect(payload.totals.verdict).toBe('loss');
    expect(payload.totals.netCad).toBe(-40);
  });
});
