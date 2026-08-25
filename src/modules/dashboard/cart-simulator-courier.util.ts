import {
  allocateStripeProcessingFeeShareCents,
  computeDeliveryNetCentsBeforeStripe,
} from '@modules/billing/stripe/stripe-processing-fee.util';

export type CartSimulatorCourierBreakdown = {
  applicable: boolean
  shippingGross: number
  platformWithheld: number
  withheldMode: string
  withheldPercent: number
  withheldFixed: number
  /** Part livreur sur les frais livraison (100 − retenue %) ; null si retenue fixe. */
  courierSharePercent: number | null
  driverNetFromShipping: number
  deliveryTip: number
  stripeProcessingFeeEstimate: number
  netAfterStripe: number
  /** Net livraison après Stripe + pourboire (100 % livreur). */
  totalEstimated: number
}

function displayToMinor(display: number, amountFactor: number): number {
  return Math.max(0, Math.round(display * amountFactor + Number.EPSILON));
}

function minorToDisplay(minor: number, amountFactor: number): number {
  if (amountFactor < 1) return minor;
  return minor / amountFactor;
}

const EMPTY: CartSimulatorCourierBreakdown = {
  applicable: false,
  shippingGross: 0,
  platformWithheld: 0,
  withheldMode: 'percent',
  withheldPercent: 0,
  withheldFixed: 0,
  courierSharePercent: null,
  driverNetFromShipping: 0,
  deliveryTip: 0,
  stripeProcessingFeeEstimate: 0,
  netAfterStripe: 0,
  totalEstimated: 0,
};

/**
 * Estimation gains livreur — même formule que le payout Connect réel :
 * retenue plateforme sur les frais livraison, puis part Stripe sur la tranche ship,
 * pourboire 100 % livreur (hors retenue).
 */
export function computeCartSimulatorCourierBreakdown(args: {
  fulfillmentIsDelivery: boolean
  deliverable: boolean
  shippingDisplay: number
  tipDisplay: number
  withheldMode: string
  withheldFixed: number
  withheldPercent: number
  amountFactor: number
  chargeCents: number
  stripeFeeTotalCents: number
}): CartSimulatorCourierBreakdown {
  if (!args.fulfillmentIsDelivery || !args.deliverable) {
    return EMPTY;
  }

  const factor = Number(args.amountFactor) > 0 ? args.amountFactor : 100;
  const shippingGross = Math.max(0, Number(args.shippingDisplay) || 0);
  const tipDisplay = Math.max(0, Number(args.tipDisplay) || 0);
  const withheldMode =
    args.withheldMode === 'fixed' ? 'fixed' : 'percent';
  const withheldPercent = Math.max(0, Number(args.withheldPercent) || 0);
  const withheldFixed = Math.max(0, Number(args.withheldFixed) || 0);

  const shipCents = displayToMinor(shippingGross, factor);
  const driverNetBeforeStripeCents = computeDeliveryNetCentsBeforeStripe({
    shipCents,
    deliveryWithheldFeeMode: withheldMode,
    deliveryWithheldFeeFixed: withheldFixed,
    deliveryWithheldFeePercent: withheldPercent,
  });
  const withheldCents = Math.max(0, shipCents - driverNetBeforeStripeCents);

  const stripeShareCents = allocateStripeProcessingFeeShareCents({
    totalStripeFeeCents: args.stripeFeeTotalCents,
    paymentAmountCents: args.chargeCents,
    sliceAmountCents: shipCents,
    maxDeductibleCents: driverNetBeforeStripeCents,
  });
  const netAfterStripeCents = Math.max(
    0,
    driverNetBeforeStripeCents - stripeShareCents,
  );

  const driverNetFromShipping = minorToDisplay(
    driverNetBeforeStripeCents,
    factor,
  );
  const netAfterStripe = minorToDisplay(netAfterStripeCents, factor);
  const platformWithheld = minorToDisplay(withheldCents, factor);
  const stripeProcessingFeeEstimate = minorToDisplay(stripeShareCents, factor);

  return {
    applicable: true,
    shippingGross,
    platformWithheld,
    withheldMode,
    withheldPercent,
    withheldFixed,
    courierSharePercent:
      withheldMode === 'percent'
        ? Math.max(0, Math.min(100, 100 - withheldPercent))
        : null,
    driverNetFromShipping,
    deliveryTip: tipDisplay,
    stripeProcessingFeeEstimate,
    netAfterStripe,
    totalEstimated: netAfterStripe + tipDisplay,
  };
}
