import { computeCartSimulatorCourierBreakdown } from './cart-simulator-courier.util';

describe('computeCartSimulatorCourierBreakdown', () => {
  it('retrait ou hors zone → applicable false, totaux à 0', () => {
    expect(
      computeCartSimulatorCourierBreakdown({
        fulfillmentIsDelivery: false,
        deliverable: true,
        shippingDisplay: 10,
        tipDisplay: 2,
        withheldMode: 'percent',
        withheldFixed: 0,
        withheldPercent: 20,
        amountFactor: 100,
        chargeCents: 5000,
        stripeFeeTotalCents: 175,
      }).applicable,
    ).toBe(false);

    expect(
      computeCartSimulatorCourierBreakdown({
        fulfillmentIsDelivery: true,
        deliverable: false,
        shippingDisplay: 10,
        tipDisplay: 2,
        withheldMode: 'percent',
        withheldFixed: 0,
        withheldPercent: 20,
        amountFactor: 100,
        chargeCents: 5000,
        stripeFeeTotalCents: 175,
      }).totalEstimated,
    ).toBe(0);
  });

  it('retenue % : net livraison = brut − part plateforme, tip 100 % livreur', () => {
    const out = computeCartSimulatorCourierBreakdown({
      fulfillmentIsDelivery: true,
      deliverable: true,
      shippingDisplay: 10,
      tipDisplay: 2,
      withheldMode: 'percent',
      withheldFixed: 0,
      withheldPercent: 20,
      amountFactor: 100,
      chargeCents: 0,
      stripeFeeTotalCents: 0,
    });
    expect(out.applicable).toBe(true);
    expect(out.platformWithheld).toBe(2);
    expect(out.driverNetFromShipping).toBe(8);
    expect(out.courierSharePercent).toBe(80);
    expect(out.deliveryTip).toBe(2);
    expect(out.netAfterStripe).toBe(8);
    expect(out.totalEstimated).toBe(10);
  });

  it('retenue fixe : part % nulle, Stripe imputé sur la tranche livraison', () => {
    const out = computeCartSimulatorCourierBreakdown({
      fulfillmentIsDelivery: true,
      deliverable: true,
      shippingDisplay: 10,
      tipDisplay: 0,
      withheldMode: 'fixed',
      withheldFixed: 1.5,
      withheldPercent: 99,
      amountFactor: 100,
      chargeCents: 5000,
      stripeFeeTotalCents: 200,
    });
    expect(out.courierSharePercent).toBeNull();
    expect(out.platformWithheld).toBe(1.5);
    expect(out.driverNetFromShipping).toBe(8.5);
    expect(out.stripeProcessingFeeEstimate).toBeGreaterThan(0);
    expect(out.netAfterStripe).toBeLessThan(out.driverNetFromShipping);
    expect(out.totalEstimated).toBe(out.netAfterStripe);
  });
});
