import {
  fromStripeMinorUnits,
  isStripeZeroDecimalCurrency,
  normalizeStripeCurrencyCode,
  stripeMinimumChargeMinorUnits,
  toStripeMinorUnits,
} from '@utils/stripe-currency-amount.util';

export type VendorBillingStripeCheckoutAmount = {
  currencyLower: string;
  currencyUpper: string;
  amountMajor: number;
  unitAmount: number;
  meetsMinimum: boolean;
};

/**
 * Montant Checkout Stripe pour facturation vendeur (Ads / SMS).
 * Devise = boutique / région (ex. XAF) — jamais forcer CAD + ×100.
 */
export function resolveVendorBillingStripeCheckoutAmount(args: {
  amountMajor: number;
  currency: string | null | undefined;
}): VendorBillingStripeCheckoutAmount {
  const currencyUpper = normalizeStripeCurrencyCode(args.currency);
  const currencyLower = currencyUpper.toLowerCase();
  // Zero-decimal (XAF) : pas de centimes côté Stripe.
  const decimals = isStripeZeroDecimalCurrency(currencyUpper) ? 0 : 2;
  const amountMajor = Number(
    Math.max(0, Number(args.amountMajor) || 0).toFixed(decimals),
  );
  const unitAmount = toStripeMinorUnits(amountMajor, currencyUpper);
  return {
    currencyLower,
    currencyUpper,
    amountMajor,
    unitAmount,
    meetsMinimum: unitAmount >= stripeMinimumChargeMinorUnits(currencyUpper),
  };
}

/** amount_total Stripe → montant majeur dans la devise de session. */
export function majorAmountFromStripeCheckoutTotal(
  amountTotal: number | null | undefined,
  currency: string | null | undefined,
): number {
  const minor = Math.max(0, Number(amountTotal) || 0);
  const code = normalizeStripeCurrencyCode(currency);
  return Number(
    fromStripeMinorUnits(minor, code).toFixed(
      isStripeZeroDecimalCurrency(code) ? 0 : 2,
    ),
  );
}
