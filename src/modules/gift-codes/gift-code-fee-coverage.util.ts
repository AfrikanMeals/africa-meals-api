/**
 * Fee Coverage gift code — pure (STORE vs PLATFORM).
 * PLATFORM : vendeur = payout pré-gift ; commission réduite de la remise puis top-up.
 */

export type GiftFeeCoverage = 'STORE' | 'PLATFORM';

/** Legacy / absent → STORE (aucune régression). */
export function normalizeGiftFeeCoverage(
  raw?: string | null,
): GiftFeeCoverage {
  return String(raw ?? '')
    .trim()
    .toUpperCase() === 'PLATFORM'
    ? 'PLATFORM'
    : 'STORE';
}

export type PlatformGiftCoverageSplit = {
  vendorGoodsCents: number;
  /** Commission retenue sur la charge (après absorption gift). */
  platformFeeFromChargeCents: number;
  /** Part vendeur financée par la charge (avant frais Stripe processing). */
  fromChargeVendorBeforeStripeCents: number;
  /** Payout vendeur cible (= pré-gift − commission pleine). */
  desiredVendorBeforeStripeCents: number;
  /** Complément depuis balance plateforme. */
  topUpCents: number;
};

/**
 * Calcule le split PLATFORM (option 1 : fee − gift, puis top-up).
 * `platformFeeOnVendorGoodsCents` = commission calculée sur les goods pré-gift.
 */
export function computePlatformGiftCoverageSplit(args: {
  chargedGoodsCents: number;
  giftCents: number;
  platformFeeOnVendorGoodsCents: number;
}): PlatformGiftCoverageSplit {
  const charged = Math.max(0, Math.round(args.chargedGoodsCents));
  const gift = Math.max(0, Math.round(args.giftCents));
  const vendorGoods = charged + gift;
  const feeOnVendor = Math.max(
    0,
    Math.round(args.platformFeeOnVendorGoodsCents),
  );
  // 1. Payout désiré comme si pas de gift.
  const desiredVendor = Math.max(0, vendorGoods - feeOnVendor);
  // 2. Commission sur charge réduite de la remise (plancher 0).
  const feeFromCharge = Math.max(0, feeOnVendor - gift);
  const fromChargeVendor = Math.max(0, charged - feeFromCharge);
  const fromChargeClamped = Math.min(fromChargeVendor, desiredVendor);
  // 3. Top-up = écart restant (jamais négatif).
  const topUp = Math.max(0, desiredVendor - fromChargeClamped);
  return {
    vendorGoodsCents: vendorGoods,
    platformFeeFromChargeCents: feeFromCharge,
    fromChargeVendorBeforeStripeCents: fromChargeClamped,
    desiredVendorBeforeStripeCents: desiredVendor,
    topUpCents: topUp,
  };
}

/** Goods vendeur pour metadata : remisés + gift (après coupon boutique). */
export function vendorGoodsCentsFromChargedAndGift(
  chargedGoodsCents: number,
  giftCents: number,
): number {
  return (
    Math.max(0, Math.round(chargedGoodsCents)) +
    Math.max(0, Math.round(giftCents))
  );
}
