/**
 * Stripe : devises « zero-decimal » — le montant API est en unités entières (×1),
 * pas en centimes (×100). Voir https://docs.stripe.com/currencies#zero-decimal
 */
export const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

export function normalizeStripeCurrencyCode(raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return t || 'CAD';
}

/** true si Stripe attend des montants entiers (sans ×100). */
export function isStripeZeroDecimalCurrency(currency: string): boolean {
  return STRIPE_ZERO_DECIMAL_CURRENCIES.has(
    normalizeStripeCurrencyCode(currency),
  );
}

/**
 * Facteur pour convertir un montant affiché → unité Stripe.
 * CAD/USD/EUR → 100 ; XAF/XOF/JPY → 1.
 */
export function stripeAmountFactor(
  currency: string,
  stripeZeroDecimalOverride?: boolean | null,
): number {
  const zeroDecimal =
    stripeZeroDecimalOverride != null
      ? Boolean(stripeZeroDecimalOverride)
      : isStripeZeroDecimalCurrency(currency);
  return zeroDecimal ? 1 : 100;
}

export function toStripeMinorUnits(
  amount: number,
  currency: string,
  stripeZeroDecimalOverride?: boolean | null,
): number {
  const factor = stripeAmountFactor(currency, stripeZeroDecimalOverride);
  return Math.max(0, Math.round(amount * factor + Number.EPSILON));
}

export function fromStripeMinorUnits(
  minorUnits: number,
  currency: string,
  stripeZeroDecimalOverride?: boolean | null,
): number {
  const factor = stripeAmountFactor(currency, stripeZeroDecimalOverride);
  return minorUnits / factor;
}

/** Minimum Stripe en unités mineures (≈ 0,50 CAD ou 100 XAF). */
export function stripeMinimumChargeMinorUnits(
  currency: string,
  stripeZeroDecimalOverride?: boolean | null,
): number {
  return stripeAmountFactor(currency, stripeZeroDecimalOverride) === 1 ? 100 : 50;
}

export function resolveStripeZeroDecimal(
  currency: string,
  stripeZeroDecimalOverride?: boolean | null,
): boolean {
  return stripeAmountFactor(currency, stripeZeroDecimalOverride) === 1;
}
