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
