export type StrategyPricingInput = {
  offerType: string;
  unitPrice: number;
  buyQuantity?: number;
  getQuantity?: number;
  rewardPercent?: number;
  spendThreshold?: number;
  rewardFixedAmount?: number;
};

export type StrategyPricingResult = {
  checkoutQuantity: number;
  /** Prix unitaire ligne panier (total = unitPrice * checkoutQuantity). */
  cartUnitPrice: number;
  lineTotal: number;
  badgeFr: string;
  badgeEn: string;
  /** Checkout direct depuis le carrousel (1 tap). */
  directCheckoutEligible: boolean;
  /** Remise calculée au niveau panier (seuil), pas sur la ligne produit. */
  cartLevelStrategy: boolean;
};

export type StrategyQuantityPricingResult = StrategyPricingResult & {
  requestedQuantity: number;
  meetsConditions: boolean;
};

export type CartStrategyBenefitInput = {
  offerType: string;
  subtotal: number;
  spendThreshold?: number;
  rewardFixedAmount?: number;
  rewardPercent?: number;
};

export type CartStrategyBenefitResult = {
  meetsThreshold: boolean;
  discountAmount: number;
  freeDelivery: boolean;
  badgeFr: string;
  badgeEn: string;
};

const roundMoney = (n: number) => Math.round(n * 100) / 100;

const CART_LEVEL_TYPES = new Set([
  'SPEND_X_GET_Y_OFF_11',
  'SPEND_X_GET_Y_12',
  'SPEND_X_FREE_DELIVERY_14',
  'SPEND_X_FREE_ITEM_15',
  'SPEND_PER_STORE_18',
]);

export function isCartLevelStrategyType(offerType: string): boolean {
  const type = String(offerType ?? '').trim().toUpperCase();
  if (CART_LEVEL_TYPES.has(type)) return true;
  if (type.startsWith('SPEND_X') && !type.includes('COUPON')) return true;
  return false;
}

/** Stratégies éligibles au checkout direct (1 produit, qty calculée ou panier). */
export function computeStrategyPricing(
  input: StrategyPricingInput,
): StrategyPricingResult {
  const base = Math.max(0, Number(input.unitPrice) || 0);
  const type = String(input.offerType ?? '').trim().toUpperCase();

  if (base <= 0 && !isCartLevelStrategyType(type)) {
    return {
      checkoutQuantity: 1,
      cartUnitPrice: 0,
      lineTotal: 0,
      badgeFr: 'Offre',
      badgeEn: 'Deal',
      directCheckoutEligible: false,
      cartLevelStrategy: false,
    };
  }

  if (isCartLevelStrategyType(type)) {
    const threshold = Math.max(0, Number(input.spendThreshold) || 0);
    const fixed = Math.max(0, Number(input.rewardFixedAmount) || 0);
    const pct = Math.min(
      99,
      Math.max(1, Math.floor(Number(input.rewardPercent) || 10)),
    );
    let badgeFr = 'Offre panier';
    let badgeEn = 'Cart deal';
    if (type === 'SPEND_X_GET_Y_OFF_11' && threshold > 0) {
      badgeFr = `-${fixed} dès ${threshold}`;
      badgeEn = `-${fixed} over ${threshold}`;
    } else if (type === 'SPEND_X_GET_Y_12' && threshold > 0) {
      badgeFr = `-${pct} % dès ${threshold}`;
      badgeEn = `-${pct}% over ${threshold}`;
    } else if (type === 'SPEND_X_FREE_DELIVERY_14' && threshold > 0) {
      badgeFr = `Livraison offerte dès ${threshold}`;
      badgeEn = `Free delivery over ${threshold}`;
    } else if (type === 'SPEND_X_FREE_ITEM_15' && threshold > 0) {
      badgeFr = `Article offert dès ${threshold}`;
      badgeEn = `Free item over ${threshold}`;
    }
    return {
      checkoutQuantity: 1,
      cartUnitPrice: base,
      lineTotal: base,
      badgeFr,
      badgeEn,
      directCheckoutEligible: true,
      cartLevelStrategy: true,
    };
  }

  switch (type) {
    case 'BOGO_1': {
      const qty = 2;
      const payUnits = 1;
      const cartUnit = roundMoney((base * payUnits) / qty);
      return {
        checkoutQuantity: qty,
        cartUnitPrice: cartUnit,
        lineTotal: roundMoney(cartUnit * qty),
        badgeFr: '2 pour 1',
        badgeEn: '2 for 1',
        directCheckoutEligible: true,
        cartLevelStrategy: false,
      };
    }
    case 'BOGO_50_2': {
      const qty = 2;
      const payUnits = 1.5;
      const cartUnit = roundMoney((base * payUnits) / qty);
      return {
        checkoutQuantity: qty,
        cartUnitPrice: cartUnit,
        lineTotal: roundMoney(cartUnit * qty),
        badgeFr: '2e à -50 %',
        badgeEn: '2nd 50% off',
        directCheckoutEligible: true,
        cartLevelStrategy: false,
      };
    }
    case 'BUY_2_GET_1_FREE_3': {
      const qty = 3;
      const payUnits = 2;
      const cartUnit = roundMoney((base * payUnits) / qty);
      return {
        checkoutQuantity: qty,
        cartUnitPrice: cartUnit,
        lineTotal: roundMoney(cartUnit * qty),
        badgeFr: '3 pour 2',
        badgeEn: '3 for 2',
        directCheckoutEligible: true,
        cartLevelStrategy: false,
      };
    }
    case 'BUY_X_GET_Y_4': {
      const buy = Math.max(1, Math.floor(Number(input.buyQuantity) || 2));
      const get = Math.max(1, Math.floor(Number(input.getQuantity) || 1));
      const qty = buy + get;
      const cartUnit = roundMoney((base * buy) / qty);
      return {
        checkoutQuantity: qty,
        cartUnitPrice: cartUnit,
        lineTotal: roundMoney(cartUnit * qty),
        badgeFr: `${buy}+${get} offert${get > 1 ? 's' : ''}`,
        badgeEn: `Buy ${buy} get ${get}`,
        directCheckoutEligible: true,
        cartLevelStrategy: false,
      };
    }
    default: {
      const pct = Math.min(
        99,
        Math.max(1, Math.floor(Number(input.rewardPercent) || 15)),
      );
      if (
        type.startsWith('SPEND_X') ||
        type.includes('FREE_DELIVERY') ||
        type.includes('COUPON')
      ) {
        return {
          checkoutQuantity: 1,
          cartUnitPrice: base,
          lineTotal: base,
          badgeFr: 'Offre panier',
          badgeEn: 'Cart offer',
          directCheckoutEligible: false,
          cartLevelStrategy: true,
        };
      }
      const discounted = roundMoney(base * (1 - pct / 100));
      return {
        checkoutQuantity: 1,
        cartUnitPrice: discounted,
        lineTotal: discounted,
        badgeFr: `-${pct} %`,
        badgeEn: `-${pct}%`,
        directCheckoutEligible: true,
        cartLevelStrategy: false,
      };
    }
  }
}

export function computeCartStrategyBenefit(
  input: CartStrategyBenefitInput,
): CartStrategyBenefitResult {
  const type = String(input.offerType ?? '').trim().toUpperCase();
  const subtotal = Math.max(0, Number(input.subtotal) || 0);
  const threshold = Math.max(0, Number(input.spendThreshold) || 0);
  const fixed = Math.max(0, Number(input.rewardFixedAmount) || 0);
  const pct = Math.min(
    99,
    Math.max(1, Math.floor(Number(input.rewardPercent) || 10)),
  );
  const meetsThreshold = threshold <= 0 || subtotal >= threshold;

  if (!meetsThreshold) {
    return {
      meetsThreshold: false,
      discountAmount: 0,
      freeDelivery: false,
      badgeFr: 'Seuil panier non atteint',
      badgeEn: 'Cart threshold not met',
    };
  }

  if (type === 'SPEND_X_FREE_DELIVERY_14') {
    return {
      meetsThreshold: true,
      discountAmount: 0,
      freeDelivery: true,
      badgeFr: 'Livraison offerte',
      badgeEn: 'Free delivery',
    };
  }

  if (type === 'SPEND_X_GET_Y_OFF_11') {
    const discountAmount = roundMoney(Math.min(fixed, subtotal));
    return {
      meetsThreshold: true,
      discountAmount,
      freeDelivery: false,
      badgeFr: `-${discountAmount}`,
      badgeEn: `-${discountAmount}`,
    };
  }

  if (type === 'SPEND_X_GET_Y_12' || type === 'SPEND_PER_STORE_18') {
    const discountAmount = roundMoney((subtotal * pct) / 100);
    return {
      meetsThreshold: true,
      discountAmount,
      freeDelivery: false,
      badgeFr: `-${pct} %`,
      badgeEn: `-${pct}%`,
    };
  }

  if (type === 'SPEND_X_FREE_ITEM_15') {
    const discountAmount = roundMoney(Math.min(fixed || subtotal, subtotal));
    return {
      meetsThreshold: true,
      discountAmount,
      freeDelivery: false,
      badgeFr: 'Article offert',
      badgeEn: 'Free item',
    };
  }

  return {
    meetsThreshold: true,
    discountAmount: 0,
    freeDelivery: false,
    badgeFr: 'Offre panier',
    badgeEn: 'Cart offer',
  };
}

export function isDirectCheckoutStrategyType(offerType: string): boolean {
  return computeStrategyPricing({
    offerType,
    unitPrice: 10,
    spendThreshold: 10,
    rewardFixedAmount: 1,
    rewardPercent: 10,
  }).directCheckoutEligible;
}

/** Prix stratégie pour une quantité choisie par l'utilisateur (fiche offre). */
export function computeStrategyPricingForQuantity(
  input: StrategyPricingInput & { quantity: number },
): StrategyQuantityPricingResult {
  const requestedQuantity = Math.max(
    1,
    Math.min(999, Math.floor(Number(input.quantity) || 1)),
  );
  const basePricing = computeStrategyPricing(input);
  const base = Math.max(0, Number(input.unitPrice) || 0);
  const type = String(input.offerType ?? '').trim().toUpperCase();

  if (isCartLevelStrategyType(type)) {
    const threshold = Math.max(0, Number(input.spendThreshold) || 0);
    const subtotal = roundMoney(base * requestedQuantity);
    const meetsConditions = threshold <= 0 || subtotal >= threshold;
    return {
      ...basePricing,
      checkoutQuantity: requestedQuantity,
      cartUnitPrice: base,
      lineTotal: subtotal,
      requestedQuantity,
      meetsConditions,
    };
  }

  const bundleQty = basePricing.checkoutQuantity;
  if (bundleQty <= 1) {
    const lineTotal = roundMoney(basePricing.cartUnitPrice * requestedQuantity);
    return {
      ...basePricing,
      checkoutQuantity: requestedQuantity,
      lineTotal,
      requestedQuantity,
      meetsConditions: requestedQuantity >= 1,
    };
  }

  const bundles = Math.floor(requestedQuantity / bundleQty);
  const remainder = requestedQuantity % bundleQty;
  const payPerBundle = basePricing.lineTotal;
  const lineTotal = roundMoney(bundles * payPerBundle + remainder * base);
  const cartUnitPrice =
    requestedQuantity > 0 ? roundMoney(lineTotal / requestedQuantity) : 0;
  const meetsConditions = requestedQuantity >= bundleQty;

  return {
    ...basePricing,
    checkoutQuantity: requestedQuantity,
    cartUnitPrice,
    lineTotal,
    requestedQuantity,
    meetsConditions,
  };
}
