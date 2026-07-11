import { PlatformFeeMode } from '@schemas/platform-fees-settings.schema';
import {
  CommissionTierBasis,
  PlanRegionOrderCommissionTierModel,
} from '@schemas/plan-region-order-commission-tier.schema';
import {
  stripeAmountFactor,
  toStripeMinorUnits,
} from '../../utils/stripe-currency-amount.util';
import { computeVendorTransferSplit } from './platform-fees.service';

export type CommissionTier = {
  minPrice: number;
  maxPrice?: number | null;
  mode: PlatformFeeMode;
  fixed: number;
  percent: number;
};

export type OrderCommissionConfig = {
  tierBasis: CommissionTierBasis;
  tiers: CommissionTier[];
  fallbackMode: PlatformFeeMode;
  fallbackFixed: number;
  fallbackPercent: number;
};

export type CommissionLineItem = {
  unitPrice: number;
  quantity: number;
  lineTotalMinor: number;
  /** Stratégie effective figée à la commande (sinon repli boutique / défaut). */
  strategy?: CommissionRetrieveStrategy;
};

export type OrderCommissionSplitMeta = {
  platformFeeCents: number;
  feeMode: PlatformFeeMode | 'tiered';
  feePercent: number;
  feeFixedCad: number;
};

function minorToDisplay(minor: number, currency: string): number {
  const factor = stripeAmountFactor(currency);
  if (factor < 1) return minor;
  return minor / factor;
}

function findTierForPrice(price: number, tiers: CommissionTier[]): CommissionTier | null {
  for (const tier of tiers) {
    if (price < tier.minPrice) continue;
    if (tier.maxPrice != null && tier.maxPrice > 0 && price >= tier.maxPrice) {
      continue;
    }
    return tier;
  }
  return null;
}

function feeFromRule(
  mode: PlatformFeeMode,
  fixed: number,
  percent: number,
  basisMinor: number,
  quantity: number,
  currency: string,
): number {
  if (basisMinor < 1) return 0;
  if (mode === 'percent') {
    return Math.max(0, Math.round(basisMinor * (percent / 100)));
  }
  const fixedMinor = toStripeMinorUnits(fixed, currency);
  const mult = quantity > 0 ? quantity : 1;
  return Math.max(0, fixedMinor * mult);
}

export function normalizeCommissionTiers(
  raw: PlanRegionOrderCommissionTierModel[] | CommissionTier[] | undefined,
): CommissionTier[] {
  if (!Array.isArray(raw)) return [];
  const out: CommissionTier[] = [];
  for (const row of raw) {
    const minPrice = Math.max(0, Number(row.minPrice ?? 0));
    const maxRaw = row.maxPrice;
    const maxPrice =
      maxRaw != null && Number(maxRaw) > 0 ? Number(maxRaw) : null;
    const mode: PlatformFeeMode = row.mode === 'fixed' ? 'fixed' : 'percent';
    const fixed = Math.max(0, Number(row.fixed ?? 0));
    const percent = Math.max(0, Number(row.percent ?? 0));
    if (mode === 'fixed' && fixed <= 0) continue;
    if (mode === 'percent' && percent <= 0) continue;
    out.push({ minPrice, maxPrice, mode, fixed, percent });
  }
  return out.sort((a, b) => a.minPrice - b.minPrice);
}

export function orderCommissionConfigFromRow(
  row: Record<string, unknown> | null | undefined,
): OrderCommissionConfig {
  const legacyMode: PlatformFeeMode =
    row?.mode === 'fixed' ? 'fixed' : 'percent';
  const legacyFixed = Math.max(0, Number(row?.fixed ?? 0));
  const legacyPercent = Math.max(0, Number(row?.percent ?? 0));

  const fallbackMode: PlatformFeeMode =
    row?.fallbackMode === 'fixed' || row?.fallbackMode === 'percent'
      ? row.fallbackMode
      : legacyMode;
  const fallbackFixed =
    row?.fallbackFixed != null
      ? Math.max(0, Number(row.fallbackFixed))
      : legacyFixed;
  const fallbackPercent =
    row?.fallbackPercent != null
      ? Math.max(0, Number(row.fallbackPercent))
      : legacyPercent;

  const tierBasis: CommissionTierBasis =
    row?.tierBasis === 'order_subtotal' ? 'order_subtotal' : 'unit_price';

  return {
    tierBasis,
    tiers: normalizeCommissionTiers(
      row?.tiers as PlanRegionOrderCommissionTierModel[] | undefined,
    ),
    fallbackMode,
    fallbackFixed,
    fallbackPercent,
  };
}

export const COMMISSION_RETRIEVE_STRATEGIES = [
  'on_payout',
  'add_to_price',
] as const;

export type CommissionRetrieveStrategy =
  (typeof COMMISSION_RETRIEVE_STRATEGIES)[number];

export function normalizeCommissionRetrieveStrategy(
  raw: unknown,
): CommissionRetrieveStrategy {
  return raw === 'add_to_price' ? 'add_to_price' : 'on_payout';
}

/** `null` = hériter (item → boutique → défaut `on_payout`). */
export function parseOptionalCommissionStrategy(
  raw: unknown,
): CommissionRetrieveStrategy | null {
  if (raw === 'add_to_price' || raw === 'on_payout') return raw;
  return null;
}

/**
 * Priorité : stratégie item → stratégie boutique → défaut (`on_payout`).
 */
export function resolveEffectiveCommissionStrategy(
  itemStrategy?: CommissionRetrieveStrategy | null,
  storeStrategy?: CommissionRetrieveStrategy | null,
): CommissionRetrieveStrategy {
  if (itemStrategy === 'add_to_price' || itemStrategy === 'on_payout') {
    return itemStrategy;
  }
  if (storeStrategy === 'add_to_price' || storeStrategy === 'on_payout') {
    return storeStrategy;
  }
  return 'on_payout';
}

export type UnitCommissionBreakdown = {
  vendorPrice: number;
  commissionAmount: number;
  customerPrice: number;
  feeMode: PlatformFeeMode | 'tiered';
  feePercent: number;
  feeFixed: number;
};

/** Commission unitaire (devise affichage) pour un prix de base vendeur. */
export function computeUnitCommission(
  vendorPrice: number,
  config: OrderCommissionConfig,
  currency: string,
): UnitCommissionBreakdown {
  const price = Math.max(0, Number(vendorPrice) || 0);
  if (price <= 0) {
    return {
      vendorPrice: 0,
      commissionAmount: 0,
      customerPrice: 0,
      feeMode: config.fallbackMode,
      feePercent: config.fallbackPercent,
      feeFixed: config.fallbackFixed,
    };
  }

  const minor = toStripeMinorUnits(price, currency);
  const meta = computeOrderCommissionCents({
    goodsMinor: minor,
    shipMinor: 0,
    lineItems: [
      {
        unitPrice: price,
        quantity: 1,
        lineTotalMinor: minor,
      },
    ],
    config,
    currency,
  });

  const commissionAmount = minorToDisplay(meta.platformFeeCents, currency);
  const tier = findTierForPrice(price, config.tiers);
  return {
    vendorPrice: price,
    commissionAmount,
    customerPrice: price + commissionAmount,
    feeMode: meta.feeMode,
    feePercent: tier?.percent ?? config.fallbackPercent,
    feeFixed: tier?.fixed ?? config.fallbackFixed,
  };
}

/** Prix client à partir du prix saisi vendeur. */
export function applyCommissionMarkup(
  vendorPrice: number,
  config: OrderCommissionConfig,
  currency: string,
  strategy: CommissionRetrieveStrategy = 'add_to_price',
): number {
  if (strategy !== 'add_to_price') {
    return Math.max(0, Number(vendorPrice) || 0);
  }
  return computeUnitCommission(vendorPrice, config, currency).customerPrice;
}

/**
 * Inverse le markup pour retrouver le prix net vendeur à partir du prix client
 * (utilisé lors du reset de stratégie pour garder le prix client stable).
 */
export function reverseCommissionMarkup(
  customerPrice: number,
  config: OrderCommissionConfig,
  currency: string,
): number {
  const target = Math.max(0, Number(customerPrice) || 0);
  if (target <= 0) return 0;

  let lo = 0;
  let hi = target;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const customer = applyCommissionMarkup(mid, config, currency, 'add_to_price');
    if (customer > target) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const factor = stripeAmountFactor(currency);
  if (factor <= 1) {
    return Math.round(lo);
  }
  return Math.round(lo * factor) / factor;
}

/** Prix catalogue exposé au client selon la stratégie boutique. */
export function resolveCustomerUnitPrice(
  vendorPrice: number,
  config: OrderCommissionConfig,
  currency: string,
  strategy: CommissionRetrieveStrategy,
): number {
  return applyCommissionMarkup(vendorPrice, config, currency, strategy);
}

/**
 * Majore prix / promo catalogue pour les listes publiques quand la stratégie
 * effective est `add_to_price`. Sinon renvoie les montants vendeur inchangés.
 */
export function markupCatalogListUnitPrices(args: {
  vendorPrice: number;
  vendorDiscountPrice?: number;
  config: OrderCommissionConfig;
  currency: string;
  strategy: CommissionRetrieveStrategy;
}): { price: number; discountPrice: number } {
  const vendorPrice = Math.max(0, Number(args.vendorPrice) || 0);
  const vendorDiscount = Math.max(0, Number(args.vendorDiscountPrice) || 0);
  if (args.strategy !== 'add_to_price') {
    return { price: vendorPrice, discountPrice: vendorDiscount };
  }
  return {
    price: resolveCustomerUnitPrice(
      vendorPrice,
      args.config,
      args.currency,
      args.strategy,
    ),
    discountPrice:
      vendorDiscount > 0
        ? resolveCustomerUnitPrice(
            vendorDiscount,
            args.config,
            args.currency,
            args.strategy,
          )
        : 0,
  };
}

/**
 * Recalcule prix / promo stockés selon le mode d’ajustement catalogue.
 * - assume_customer_prices : DB = prix client → net vendeur (reverse markup)
 * - assume_vendor_net : DB = net → prix client (apply markup)
 */
export function adjustStoredCatalogUnitPrices(args: {
  vendorPrice: number;
  vendorDiscountPrice?: number;
  config: OrderCommissionConfig;
  currency: string;
  mode: 'assume_customer_prices' | 'assume_vendor_net';
}): { price: number; discountPrice: number } {
  const price = Math.max(0, Number(args.vendorPrice) || 0);
  const discount = Math.max(0, Number(args.vendorDiscountPrice) || 0);
  if (args.mode === 'assume_customer_prices') {
    return {
      price: reverseCommissionMarkup(price, args.config, args.currency),
      discountPrice:
        discount > 0
          ? reverseCommissionMarkup(discount, args.config, args.currency)
          : 0,
    };
  }
  return {
    price: applyCommissionMarkup(price, args.config, args.currency, 'add_to_price'),
    discountPrice:
      discount > 0
        ? applyCommissionMarkup(
            discount,
            args.config,
            args.currency,
            'add_to_price',
          )
        : 0,
  };
}

/** Ajuste un montant unitaire stocké (variante, priceDelta, supplément). */
export function adjustStoredCatalogAmount(
  amount: number,
  config: OrderCommissionConfig,
  currency: string,
  mode: 'assume_customer_prices' | 'assume_vendor_net' | 'to_vendor_net' | 'to_customer',
): number {
  const n = Math.max(0, Number(amount) || 0);
  if (n <= 0) return 0;
  if (mode === 'assume_customer_prices' || mode === 'to_vendor_net') {
    return reverseCommissionMarkup(n, config, currency);
  }
  return applyCommissionMarkup(n, config, currency, 'add_to_price');
}

/**
 * Ajuste in-place variantes / compléments / suppléments d’un document produit
 * lors d’un reset ou d’un adjust de stratégie catalogue.
 */
export function adjustStoredCatalogComponentPrices(args: {
  variants?: Array<Record<string, unknown>> | null;
  complements?: Array<Record<string, unknown>> | null;
  supplements?: Array<Record<string, unknown>> | null;
  config: OrderCommissionConfig;
  currency: string;
  mode: 'assume_customer_prices' | 'assume_vendor_net' | 'to_vendor_net' | 'to_customer';
}): {
  variants?: Array<Record<string, unknown>>;
  complements?: Array<Record<string, unknown>>;
  supplements?: Array<Record<string, unknown>>;
} {
  const out: {
    variants?: Array<Record<string, unknown>>;
    complements?: Array<Record<string, unknown>>;
    supplements?: Array<Record<string, unknown>>;
  } = {};

  if (Array.isArray(args.variants) && args.variants.length) {
    out.variants = args.variants.map((v) => {
      const row = { ...v };
      const adj = adjustStoredCatalogUnitPrices({
        vendorPrice: Number(row.price ?? 0),
        vendorDiscountPrice: Number(row.discountPrice ?? row.discount_price ?? 0),
        config: args.config,
        currency: args.currency,
        mode:
          args.mode === 'to_vendor_net'
            ? 'assume_customer_prices'
            : args.mode === 'to_customer'
              ? 'assume_vendor_net'
              : args.mode,
      });
      row.price = adj.price;
      if (row.discountPrice != null || row.discount_price != null) {
        row.discountPrice = adj.discountPrice;
      }
      return row;
    });
  }

  if (Array.isArray(args.complements) && args.complements.length) {
    out.complements = args.complements.map((g) => {
      const group = { ...g };
      const opts = Array.isArray(g.options) ? g.options : [];
      group.options = opts.map((o) => {
        if (!o || typeof o !== 'object') return o;
        const opt = { ...(o as Record<string, unknown>) };
        opt.priceDelta = adjustStoredCatalogAmount(
          Number(opt.priceDelta ?? opt.price_delta ?? 0),
          args.config,
          args.currency,
          args.mode,
        );
        return opt;
      });
      return group;
    });
  }

  if (Array.isArray(args.supplements) && args.supplements.length) {
    out.supplements = args.supplements.map((s) => {
      const row = { ...s };
      row.price = adjustStoredCatalogAmount(
        Number(row.price ?? 0),
        args.config,
        args.currency,
        args.mode,
      );
      return row;
    });
  }

  return out;
}

/**
 * Majore in-place les prix client d’une ligne catalogue (variantes + extras)
 * pour `add_to_price`. No-op si `on_payout`.
 */
export function markupCatalogRowComponentPrices(args: {
  row: Record<string, unknown>;
  config: OrderCommissionConfig;
  currency: string;
  strategy: CommissionRetrieveStrategy;
  /** Prix de base vendeur (avant markup ligne) pour répartir la commission extras. */
  vendorBasePrice?: number;
}): void {
  if (args.strategy !== 'add_to_price') return;
  const row = args.row;

  const variants = row.variants;
  if (Array.isArray(variants)) {
    for (const raw of variants) {
      if (!raw || typeof raw !== 'object') continue;
      const v = raw as Record<string, unknown>;
      const marked = markupCatalogListUnitPrices({
        vendorPrice: Number(v.price ?? 0),
        vendorDiscountPrice: Number(v.discountPrice ?? v.discount_price ?? 0),
        config: args.config,
        currency: args.currency,
        strategy: 'add_to_price',
      });
      v.price = marked.price;
      if (v.discountPrice != null || v.discount_price != null) {
        v.discountPrice = marked.discountPrice;
      }
    }
  }

  const complements = row.complements;
  const supplements = row.supplements;
  const hasExtras =
    (Array.isArray(complements) && complements.length > 0) ||
    (Array.isArray(supplements) && supplements.length > 0);
  if (!hasExtras) return;

  const vendorBase = Math.max(
    0,
    Number(
      args.vendorBasePrice ??
        row.vendorPrice ??
        row.price ??
        0,
    ) || 0,
  );

  type CompGroup = {
    options?: Array<{ priceDelta?: number; [k: string]: unknown }>;
    [k: string]: unknown;
  };
  type SuppRow = { price?: number; [k: string]: unknown };

  const compGroups = (Array.isArray(complements) ? complements : []) as CompGroup[];
  const suppRows = (Array.isArray(supplements) ? supplements : []) as SuppRow[];
  const extras: number[] = [];
  const meta: Array<
    | { kind: 'complement'; gi: number; oi: number }
    | { kind: 'supplement'; si: number }
  > = [];

  compGroups.forEach((g, gi) => {
    (g.options ?? []).forEach((o, oi) => {
      extras.push(Math.max(0, Number(o.priceDelta) || 0));
      meta.push({ kind: 'complement', gi, oi });
    });
  });
  suppRows.forEach((s, si) => {
    extras.push(Math.max(0, Number(s.price) || 0));
    meta.push({ kind: 'supplement', si });
  });

  if (!extras.length) return;

  const components = applyCommissionMarkupToPriceComponents(
    vendorBase,
    extras,
    args.config,
    args.currency,
    'add_to_price',
  );

  meta.forEach((m, idx) => {
    const customerExtra = components.customerExtras[idx] ?? 0;
    if (m.kind === 'complement') {
      const opt = compGroups[m.gi]?.options?.[m.oi];
      if (opt) opt.priceDelta = customerExtra;
    } else {
      const s = suppRows[m.si];
      if (s) s.price = customerExtra;
    }
  });
}

/** Somme des extras vendeur (priceDelta compléments + prix suppléments). */
export function sumVendorCustomizationExtras(args: {
  complements?: Array<{ options?: Array<{ priceDelta?: number }> }>;
  supplements?: Array<{ price?: number }>;
}): number {
  let total = 0;
  for (const g of args.complements ?? []) {
    for (const o of g.options ?? []) {
      const d = Number(o.priceDelta ?? 0);
      if (Number.isFinite(d) && d > 0) total += d;
    }
  }
  for (const s of args.supplements ?? []) {
    const p = Number(s.price ?? 0);
    if (Number.isFinite(p) && p > 0) total += p;
  }
  return total;
}

export type CustomerPriceComponents = {
  customerBase: number;
  customerExtras: number[];
  vendorTotal: number;
  customerTotal: number;
  commissionAmount: number;
};

/**
 * Prix client pour base + extras (compléments / suppléments).
 *
 * - Commission calculée sur le **total ligne** (base + extras) pour le montant global.
 * - Affichage : base porte les frais fixes ; les extras sont majorés au % uniquement
 *   (évite d’appliquer N fois un forfait fixe sur chaque option).
 * - Au panier, préférer `resolveCustomerUnitPrice(base + extras)` pour le total exact.
 */
export function applyCommissionMarkupToPriceComponents(
  vendorBase: number,
  vendorExtras: number[],
  config: OrderCommissionConfig,
  currency: string,
  strategy: CommissionRetrieveStrategy,
): CustomerPriceComponents {
  const base = Math.max(0, Number(vendorBase) || 0);
  const extras = vendorExtras.map((e) => Math.max(0, Number(e) || 0));
  const vendorTotal = base + extras.reduce((a, b) => a + b, 0);
  if (strategy !== 'add_to_price' || vendorTotal <= 0) {
    return {
      customerBase: base,
      customerExtras: extras,
      vendorTotal,
      customerTotal: vendorTotal,
      commissionAmount: 0,
    };
  }

  const factor = stripeAmountFactor(currency);
  const roundMoney = (n: number) =>
    factor <= 1 ? Math.round(n) : Math.round(n * factor) / factor;

  const lineBreakdown = computeUnitCommission(vendorTotal, config, currency);
  const customerTotal = lineBreakdown.customerPrice;
  const commissionAmount = lineBreakdown.commissionAmount;

  const customerBase = applyCommissionMarkup(
    base,
    config,
    currency,
    'add_to_price',
  );

  const customerExtras = extras.map((extra) => {
    if (extra <= 0) return 0;
    const extraBreakdown = computeUnitCommission(extra, config, currency);
    // Forfait fixe : ne pas le rejouer sur chaque option (déjà sur la base).
    if (
      extraBreakdown.feeMode === 'fixed' ||
      (extraBreakdown.feeFixed > 0 && extraBreakdown.feePercent <= 0)
    ) {
      return extra;
    }
    if (extraBreakdown.feePercent > 0) {
      return roundMoney(extra * (1 + extraBreakdown.feePercent / 100));
    }
    return extra;
  });

  return {
    customerBase: roundMoney(customerBase),
    customerExtras: customerExtras.map(roundMoney),
    vendorTotal,
    customerTotal: roundMoney(customerTotal),
    commissionAmount: roundMoney(commissionAmount),
  };
}

export function computeOrderCommissionCents(args: {
  goodsMinor: number;
  shipMinor: number;
  lineItems?: CommissionLineItem[];
  config: OrderCommissionConfig;
  currency: string;
}): OrderCommissionSplitMeta {
  const goods = Math.max(0, Math.round(args.goodsMinor));
  const ship = Math.max(0, Math.round(args.shipMinor));
  const gross = goods + ship;
  const currency = args.currency;
  const config = args.config;

  if (gross < 1) {
    return {
      platformFeeCents: 0,
      feeMode: config.fallbackMode,
      feePercent: config.fallbackPercent,
      feeFixedCad: config.fallbackFixed,
    };
  }

  if (!config.tiers.length) {
    const legacy = computeVendorTransferSplit(
      gross,
      {
        platformOrderFeeMode: config.fallbackMode,
        platformOrderFeeFixed: config.fallbackFixed,
        platformOrderFeePercent: config.fallbackPercent,
      },
      currency,
    );
    return {
      platformFeeCents: legacy.platformFeeCents,
      feeMode: legacy.feeMode,
      feePercent: legacy.feePercent,
      feeFixedCad: legacy.feeFixedCad,
    };
  }

  let platformFeeCents = 0;

  if (config.tierBasis === 'unit_price' && args.lineItems?.length) {
    for (const line of args.lineItems) {
      const qty = Math.max(0, Math.round(line.quantity));
      const lineMinor = Math.max(0, Math.round(line.lineTotalMinor));
      if (lineMinor < 1 || qty < 1) continue;
      const unitPrice =
        line.unitPrice > 0
          ? line.unitPrice
          : minorToDisplay(Math.round(lineMinor / qty), currency);
      const tier = findTierForPrice(unitPrice, config.tiers);
      const mode = tier?.mode ?? config.fallbackMode;
      const fixed = tier?.fixed ?? config.fallbackFixed;
      const percent = tier?.percent ?? config.fallbackPercent;
      platformFeeCents += feeFromRule(mode, fixed, percent, lineMinor, qty, currency);
    }
    if (ship > 0) {
      platformFeeCents += feeFromRule(
        config.fallbackMode,
        config.fallbackFixed,
        config.fallbackPercent,
        ship,
        1,
        currency,
      );
    }
  } else {
    const basisMinor =
      config.tierBasis === 'order_subtotal' ? gross : goods;
    const basisDisplay = minorToDisplay(basisMinor, currency);
    const tier = findTierForPrice(basisDisplay, config.tiers);
    const mode = tier?.mode ?? config.fallbackMode;
    const fixed = tier?.fixed ?? config.fallbackFixed;
    const percent = tier?.percent ?? config.fallbackPercent;
    const qtyForFixed = config.tierBasis === 'order_subtotal' ? 1 : 0;
    platformFeeCents = feeFromRule(
      mode,
      fixed,
      percent,
      basisMinor,
      qtyForFixed,
      currency,
    );
    if (config.tierBasis === 'unit_price' && ship > 0) {
      platformFeeCents += feeFromRule(
        config.fallbackMode,
        config.fallbackFixed,
        config.fallbackPercent,
        ship,
        1,
        currency,
      );
    }
  }

  platformFeeCents = Math.max(0, Math.min(platformFeeCents, gross));

  return {
    platformFeeCents,
    feeMode: 'tiered',
    feePercent: config.fallbackPercent,
    feeFixedCad: config.fallbackFixed,
  };
}
