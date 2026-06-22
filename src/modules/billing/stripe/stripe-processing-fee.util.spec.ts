import {
  allocatePlatformFeeToGoodsCents,
  allocateStripeProcessingFeeShareCents,
  computeDeliveryNetCentsBeforeStripe,
  effectiveStripeProcessingFeeCents,
  estimateStripeProcessingFeeCents,
  scaleStorePayoutMinorToPaymentShare,
} from './stripe-processing-fee.util';

describe('stripe-processing-fee.util', () => {
  it('effectiveStripeProcessingFeeCents uses conservative fallback on 1020', () => {
    expect(effectiveStripeProcessingFeeCents(null, 1020)).toBe(68);
  });

  it('estimateStripeProcessingFeeCents matches ceil(2.9%) + 30¢ on 1000', () => {
    expect(estimateStripeProcessingFeeCents(1000)).toBe(59);
  });

  it('allocateStripeProcessingFeeShareCents is proportional', () => {
    const totalFee = 68;
    const payment = 1020;
    const goods = 1000;
    expect(
      allocateStripeProcessingFeeShareCents({
        totalStripeFeeCents: totalFee,
        paymentAmountCents: payment,
        sliceAmountCents: goods,
        maxDeductibleCents: goods,
      }),
    ).toBe(67);
  });

  it('allocatePlatformFeeToGoodsCents splits fee across goods and ship', () => {
    expect(
      allocatePlatformFeeToGoodsCents({
        platformFeeCents: 100,
        goodsCents: 1000,
        shipCents: 200,
      }),
    ).toBe(83);
  });

  it('computeDeliveryNetCentsBeforeStripe applies percent withheld', () => {
    expect(
      computeDeliveryNetCentsBeforeStripe({
        shipCents: 500,
        deliveryWithheldFeeMode: 'percent',
        deliveryWithheldFeeFixed: 0,
        deliveryWithheldFeePercent: 10,
      }),
    ).toBe(450);
  });

  it('scaleStorePayoutMinorToPaymentShare scales XAF-like payout to CAD charge', () => {
    const scaled = scaleStorePayoutMinorToPaymentShare({
      goodsCents: 1488,
      shipCents: 0,
      totalPayoutGrossMinor: 1488,
      paymentTotalMinor: 367,
    });
    expect(scaled.goodsCents).toBe(367);
    expect(scaled.shipCents).toBe(0);
  });

  it('scaleStorePayoutMinorToPaymentShare leaves aligned amounts unchanged', () => {
    expect(
      scaleStorePayoutMinorToPaymentShare({
        goodsCents: 1000,
        shipCents: 200,
        totalPayoutGrossMinor: 1200,
        paymentTotalMinor: 1259,
      }),
    ).toEqual({ goodsCents: 1000, shipCents: 200 });
  });
});
