/**
 * Pricing pur pour bundles multi-produit.
 * Le prix original = somme des customerPrice de chaque item (commission incluse si add_to_price).
 * La remise bundle s'applique ensuite (% ou fixe) sur ce total.
 */

const roundMoney = (n: number) => Math.round(n * 100) / 100;

export type BundleItemPriceInput = {
  /** Prix client final de l'item (après commission add_to_price éventuelle). */
  customerPrice: number;
};

export type BundlePricingInput = {
  items: BundleItemPriceInput[];
  discountType: 'percent' | 'fixed';
  discountValue: number;
};

export type BundlePricingResult = {
  /** Somme des prix individuels (sans remise bundle). */
  originalTotal: number;
  /** Montant de la remise bundle. */
  discountAmount: number;
  /** Prix final après remise bundle. */
  bundlePrice: number;
  /** Pourcentage d'économie (0–100). */
  savingsPercent: number;
  /** Badge affiché côté mobile (ex. « -15 % », « -5 $ »). */
  badgeFr: string;
  badgeEn: string;
};

/**
 * Calcule le pricing d'un bundle à partir des prix individuels des items.
 * La remise s'applique sur le total des customerPrice (commission déjà incluse
 * si la stratégie boutique est `add_to_price`).
 */
export function computeBundlePricing(
  input: BundlePricingInput,
): BundlePricingResult {
  const originalTotal = roundMoney(
    input.items.reduce((sum, it) => sum + Math.max(0, it.customerPrice), 0),
  );

  if (originalTotal <= 0) {
    return {
      originalTotal: 0,
      discountAmount: 0,
      bundlePrice: 0,
      savingsPercent: 0,
      badgeFr: 'Bundle',
      badgeEn: 'Bundle',
    };
  }

  const discountValue = Math.max(0, Number(input.discountValue) || 0);
  let discountAmount: number;

  if (input.discountType === 'percent') {
    // Plafonner à 99 % pour éviter un bundle gratuit
    const pct = Math.min(99, discountValue);
    discountAmount = roundMoney((originalTotal * pct) / 100);
  } else {
    // Remise fixe — ne peut pas dépasser le total
    discountAmount = roundMoney(Math.min(discountValue, originalTotal));
  }

  const bundlePrice = roundMoney(originalTotal - discountAmount);
  const savingsPercent =
    originalTotal > 0 ? roundMoney((discountAmount / originalTotal) * 100) : 0;

  // Badges visuels
  let badgeFr: string;
  let badgeEn: string;
  if (input.discountType === 'percent') {
    badgeFr = `-${Math.round(discountValue)} %`;
    badgeEn = `-${Math.round(discountValue)}%`;
  } else {
    badgeFr = `-${discountValue}`;
    badgeEn = `-${discountValue}`;
  }

  return {
    originalTotal,
    discountAmount,
    bundlePrice,
    savingsPercent,
    badgeFr,
    badgeEn,
  };
}
