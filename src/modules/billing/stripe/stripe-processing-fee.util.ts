/**
 * Estimation et répartition des frais Stripe « processing » (ex. 2,9 % + 0,30 $ CA).
 * Utilisé quand le balance_transaction n’est pas encore disponible.
 */

export type StripeProcessingFeeConfig = {
  percent: number;
  fixedCents: number;
};

export const DEFAULT_STRIPE_PROCESSING_FEE: StripeProcessingFeeConfig = {
  percent: 2.9,
  fixedCents: 30,
};

/** Frais Stripe estimés sur un montant encaissé (centimes). */
export function estimateStripeProcessingFeeCents(
  chargeAmountCents: number,
  config: StripeProcessingFeeConfig = DEFAULT_STRIPE_PROCESSING_FEE,
): number {
  const amount = Math.max(0, Math.round(chargeAmountCents));
  if (amount < 1) return 0;
  const pct = Math.max(0, config.percent);
  const fixed = Math.max(0, Math.round(config.fixedCents));
  const variable = Math.ceil((amount * pct) / 100);
  return Math.max(0, Math.min(amount, variable + fixed));
}

/** Frais réels Stripe si connus, sinon estimation prudente (max 2,9 % + 0,30 $ et ~3,7 % + 0,30 $). */
export function effectiveStripeProcessingFeeCents(
  actualFeeCents: number | null | undefined,
  chargeAmountCents: number,
): number {
  const amount = Math.max(0, Math.round(chargeAmountCents));
  if (amount < 1) return 0;
  if (actualFeeCents != null && actualFeeCents > 0) {
    return Math.min(amount, Math.round(actualFeeCents));
  }
  return Math.max(
    estimateStripeProcessingFeeCents(amount),
    estimateStripeProcessingFeeCents(amount, { percent: 3.7, fixedCents: 30 }),
  );
}

/**
 * Part des frais Stripe imputable à une tranche du paiement (ex. une boutique ou la livraison).
 * `sliceAmountCents` : portion du paiement concernée (articles, livraison, etc.).
 */
export function allocateStripeProcessingFeeShareCents(args: {
  totalStripeFeeCents: number;
  paymentAmountCents: number;
  sliceAmountCents: number;
  maxDeductibleCents: number;
}): number {
  const paymentAmount = Math.max(0, Math.round(args.paymentAmountCents));
  const slice = Math.max(0, Math.round(args.sliceAmountCents));
  const maxDeduct = Math.max(0, Math.round(args.maxDeductibleCents));
  const totalFee = Math.max(0, Math.round(args.totalStripeFeeCents));

  if (totalFee < 1 || paymentAmount < 1 || slice < 1 || maxDeduct < 1) {
    return 0;
  }

  const proportional = Math.round((totalFee * slice) / paymentAmount);
  return Math.max(0, Math.min(proportional, maxDeduct, totalFee));
}

/** Répartit la commission plateforme entre articles et livraison (centimes). */
export function allocatePlatformFeeToGoodsCents(args: {
  platformFeeCents: number;
  goodsCents: number;
  shipCents: number;
}): number {
  const fee = Math.max(0, Math.round(args.platformFeeCents));
  const goods = Math.max(0, Math.round(args.goodsCents));
  const ship = Math.max(0, Math.round(args.shipCents));
  const gross = goods + ship;
  if (fee < 1 || goods < 1) return 0;
  if (gross < 1) return Math.min(fee, goods);
  if (ship < 1) return Math.min(fee, goods);
  return Math.max(0, Math.min(fee, Math.round((fee * goods) / gross)));
}

/** Net livreur avant frais Stripe (centimes), après retenue plateforme livraison. */
export function computeDeliveryNetCentsBeforeStripe(args: {
  shipCents: number;
  deliveryWithheldFeeMode: string;
  deliveryWithheldFeeFixed: number;
  deliveryWithheldFeePercent: number;
}): number {
  const ship = Math.max(0, Math.round(args.shipCents));
  if (ship < 1) return 0;
  const withheld =
    args.deliveryWithheldFeeMode === 'percent'
      ? Math.round(
          (ship * (Math.max(0, args.deliveryWithheldFeePercent) || 0)) / 100,
        )
      : Math.round((Math.max(0, args.deliveryWithheldFeeFixed) || 0) * 100);
  return Math.max(0, ship - Math.min(withheld, ship));
}
