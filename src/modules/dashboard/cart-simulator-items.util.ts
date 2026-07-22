/**
 * Normalise une ligne simulateur : catalogue (+ options) ou prix libre.
 * Contrat partagé service + specs (pas de dépendance Nest).
 */
export type CartSimulatorRawItem = {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  title?: string;
  selectedVariantLabel?: string;
  selectedComplements?: unknown;
  selectedSupplements?: unknown;
};

export type CartSimulatorNormalizedCatalogItem = {
  kind: 'catalog';
  productId: string;
  quantity: number;
  selectedVariantLabel?: string;
  selectedComplements?: unknown;
  selectedSupplements?: unknown;
};

export type CartSimulatorNormalizedCustomItem = {
  kind: 'custom';
  /** Clé stable pour l’UI (pas un ObjectId). */
  lineKey: string;
  title: string;
  unitPrice: number;
  quantity: number;
};

export type CartSimulatorNormalizedItem =
  | CartSimulatorNormalizedCatalogItem
  | CartSimulatorNormalizedCustomItem;

function clampQty(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(99, n));
}

/** ObjectId Mongo 24 hex — sinon traité comme prix libre. */
export function isCartSimulatorCatalogProductId(id: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(id.trim());
}

/**
 * Parse les items DTO : au moins une ligne catalogue ou prix libre valide.
 * @throws Error message code métier si aucune ligne utilisable
 */
export function normalizeCartSimulatorItems(
  items: CartSimulatorRawItem[],
): CartSimulatorNormalizedItem[] {
  const out: CartSimulatorNormalizedItem[] = [];
  let customIndex = 0;

  for (const item of items ?? []) {
    const qty = clampQty(item.quantity);
    const pid = String(item.productId ?? '').trim();

    // 1. Ligne catalogue si productId Mongo valide.
    if (pid && isCartSimulatorCatalogProductId(pid)) {
      const variant = String(item.selectedVariantLabel ?? '').trim();
      out.push({
        kind: 'catalog',
        productId: pid,
        quantity: qty,
        ...(variant ? { selectedVariantLabel: variant } : {}),
        ...(item.selectedComplements !== undefined
          ? { selectedComplements: item.selectedComplements }
          : {}),
        ...(item.selectedSupplements !== undefined
          ? { selectedSupplements: item.selectedSupplements }
          : {}),
      });
      continue;
    }

    // 2. Prix libre : unitPrice requis (≥ 0).
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      continue;
    }
    const title =
      String(item.title ?? '').trim() || `Prix libre ${customIndex + 1}`;
    customIndex += 1;
    out.push({
      kind: 'custom',
      lineKey: `custom-${customIndex}`,
      title,
      unitPrice,
      quantity: qty,
    });
  }

  if (!out.length) {
    throw new Error('cart_simulator_no_valid_items');
  }
  return out;
}

/**
 * Pays boutique pour devise simulateur : `region` puis adresse physique.
 * Évite le piège `resolveStoreTaxCountryCode` (téléphone CA / CAD → CA) qui écrase un magasin CM.
 */
export function resolveCartSimulatorRegionCode(store: {
  region?: unknown;
  address?: { countryCode?: unknown } | null;
}): string {
  const fromRegion = String(store.region ?? '')
    .trim()
    .toUpperCase();
  if (/^[A-Z]{2}$/.test(fromRegion)) return fromRegion;

  const addr = store.address;
  const fromAddr =
    addr && typeof addr === 'object' && !Array.isArray(addr)
      ? String(
          (addr as { countryCode?: unknown }).countryCode ?? '',
        )
          .trim()
          .toUpperCase()
      : '';
  return /^[A-Z]{2}$/.test(fromAddr) ? fromAddr : '';
}

/**
 * Pays fiscal simulateur : région boutique → taxe boutique → livraison → user.
 * Aligné checkout (`resolveOrderTaxCountryForStore` priorise la boutique).
 */
export function resolveCartSimulatorTaxCountryCode(args: {
  storeRegionCode?: string | null;
  storeTaxFallback?: string | null;
  deliveryCountryCode?: string | null;
  userTaxCountryCode?: string | null;
}): string {
  for (const raw of [
    args.storeRegionCode,
    args.storeTaxFallback,
    args.deliveryCountryCode,
    args.userTaxCountryCode,
  ]) {
    const code = String(raw ?? '')
      .trim()
      .toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return '';
}

/**
 * Facteur de réduction coupon sur les lignes (0–1).
 * Remise appliquée au sous-total articles uniquement (comme le checkout).
 */
export function cartSimulatorCouponFactor(
  goodsDisplay: number,
  couponDiscountDisplay: number,
): number {
  const goods = Math.max(0, Number(goodsDisplay) || 0);
  if (goods <= 0) return 1;
  const discount = Math.max(0, Math.min(goods, Number(couponDiscountDisplay) || 0));
  return Math.max(0, (goods - discount) / goods);
}

/**
 * Net vendeur après commission → Stripe → payout Wise Eat (unités mineures).
 * Payout = cash-out bancaire estimé sur le net Connect.
 */
export function stackVendorNetAfterFeesCents(args: {
  vendorNetAfterCommissionCents: number;
  stripeFeeShareCents: number;
  payoutFeeCents: number;
}): {
  netAfterStripeCents: number;
  netAfterPayoutCents: number;
} {
  const afterCommission = Math.max(
    0,
    Math.round(args.vendorNetAfterCommissionCents),
  );
  const stripe = Math.max(0, Math.round(args.stripeFeeShareCents));
  const afterStripe = Math.max(0, afterCommission - Math.min(stripe, afterCommission));
  const payout = Math.max(0, Math.round(args.payoutFeeCents));
  return {
    netAfterStripeCents: afterStripe,
    netAfterPayoutCents: Math.max(0, afterStripe - Math.min(payout, afterStripe)),
  };
}

/**
 * Devise simulateur : région boutique (CM → XAF) prioritaire sur `store.currency` legacy.
 * Ignore CAD legacy si un pays hors CA est connu.
 */
export function resolveCartSimulatorCurrency(args: {
  regionCurrency: string | null | undefined;
  storeCurrency: string | null | undefined;
  regionCode?: string | null | undefined;
  fallback?: string;
}): string {
  const fromRegion = String(args.regionCurrency ?? '')
    .trim()
    .toUpperCase();
  if (/^[A-Z]{3}$/.test(fromRegion)) return fromRegion;

  const regionCode = String(args.regionCode ?? '')
    .trim()
    .toUpperCase();
  const fromStore = String(args.storeCurrency ?? '')
    .trim()
    .toUpperCase();
  // Fix: CAD legacy sur boutique CM ne doit jamais gagner si la région est connue.
  if (
    /^[A-Z]{3}$/.test(fromStore) &&
    !(fromStore === 'CAD' && regionCode && regionCode !== 'CA')
  ) {
    return fromStore;
  }

  const fb = String(args.fallback ?? 'CAD')
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(fb) ? fb : 'CAD';
}
