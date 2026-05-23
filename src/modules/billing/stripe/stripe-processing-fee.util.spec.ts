import {
  allocatePlatformFeeToGoodsCents,
  allocateStripeProcessingFeeShareCents,
  computeDeliveryNetCentsBeforeStripe,
  effectiveStripeProcessingFeeCents,
  estimateStripeProcessingFeeCents,
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
});
