/** Méthode de répartition du pourboire entre commandes livraison d'un checkout groupé. */
export const DELIVERY_TIP_ALLOCATION_BY_SHIPPING_FEE = 'by_shipping_fee';

export type DeliveryTipAllocationLeg = {
  storeId: string;
  shipCents: number;
};

export type DeliveryTipAllocationResult = {
  storeId: string;
  shipCents: number;
  shippingWeight: number;
  allocatedTipCents: number;
};

/**
 * Répartit un pourboire total sur les jambes livraison.
 * - Proportionnel aux frais livraison (`shipCents`) si somme > 0.
 * - Sinon parts égales.
 * - Centimes restants sur la dernière ligne (tri `storeId` asc).
 */
export function allocateDeliveryTipCents(params: {
  tipTotalCents: number;
  legs: DeliveryTipAllocationLeg[];
}): DeliveryTipAllocationResult[] {
  const tipTotal = Math.max(0, Math.round(params.tipTotalCents));
  const sorted = [...params.legs].sort((a, b) =>
    a.storeId.localeCompare(b.storeId),
  );
  if (!sorted.length) return [];
  if (tipTotal < 1) {
    return sorted.map((leg) => ({
      storeId: leg.storeId,
      shipCents: Math.max(0, Math.round(leg.shipCents)),
      shippingWeight: 0,
      allocatedTipCents: 0,
    }));
  }

  const normalized = sorted.map((leg) => ({
    storeId: leg.storeId,
    shipCents: Math.max(0, Math.round(leg.shipCents)),
  }));
  const sumShip = normalized.reduce((acc, leg) => acc + leg.shipCents, 0);

  const weights =
    sumShip > 0
      ? normalized.map((leg) => leg.shipCents / sumShip)
      : normalized.map(() => 1 / normalized.length);

  let allocatedSum = 0;
  const out: DeliveryTipAllocationResult[] = [];

  for (let i = 0; i < normalized.length; i++) {
    const leg = normalized[i];
    const isLast = i === normalized.length - 1;
    let cents: number;
    if (isLast) {
      cents = tipTotal - allocatedSum;
    } else {
      cents = Math.floor(tipTotal * weights[i]);
      allocatedSum += cents;
    }
    out.push({
      storeId: leg.storeId,
      shipCents: leg.shipCents,
      shippingWeight: weights[i],
      allocatedTipCents: Math.max(0, cents),
    });
  }

  return out;
}

/** Plafond tip : 50 % du sous-total articles des boutiques en livraison (centimes). */
export function maxDeliveryTipCentsForGoodsSubtotal(goodsSubtotalCents: number): number {
  const base = Math.max(0, Math.round(goodsSubtotalCents));
  return Math.floor(base * 0.5);
}
