/**
 * Convertit un prix Partner affiché (ex. 10_000 XAF) en unité Stripe API.
 * Utilise le facteur Régions (`stripeZeroDecimal` → ×1, sinon ×100).
 *
 * Fix: dollarsToCents (×100) sur XAF transformait 10_000 FCFA → 1_000_000.
 */
export function partnerPriceToStripeMinorUnits(
  pricePaid: number,
  stripeAmountFactor: number,
): number {
  const factor =
    Number.isFinite(stripeAmountFactor) && stripeAmountFactor > 0
      ? stripeAmountFactor
      : 100;
  return Math.max(0, Math.round(Number(pricePaid) * factor + Number.EPSILON));
}

/** Minimum Stripe en unités mineures selon le facteur région. */
export function partnerStripeMinimumMinorUnits(
  stripeAmountFactor: number,
): number {
  return stripeAmountFactor === 1 ? 100 : 50;
}
