import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import {
  computePayoutFeeSplit,
  computeVendorTransferSplit,
  PlatformFeesService,
  PayoutFeeSplit,
  VendorTransferSplit,
} from '@modules/platform-fees/platform-fees.service';
import {
  CommissionLineItem,
  computeOrderCommissionCents,
  orderCommissionConfigFromRow,
  OrderCommissionConfig,
  OrderCommissionSplitMeta,
} from '@modules/platform-fees/platform-order-commission.util';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { OrdeLineItem } from '@schemas/order.schema';
import { PlanRegionOrderCommissionModel } from '@schemas/plan-region-order-commission.schema';
import { PlanRegionPricingModel } from '@schemas/plan-region-pricing.schema';
import { PlatformFeeMode } from '@schemas/platform-fees-settings.schema';
import { StoreModel } from '@schemas/store.schema';
import { SubscriptionPlanModel } from '@schemas/subscription-plan.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { Model, Types } from 'mongoose';
import {
  stripeAmountFactor,
  toStripeMinorUnits,
} from '../../utils/stripe-currency-amount.util';

export type ResolvedOrderCommissionSettings = {
  config: OrderCommissionConfig;
  currency: string;
  source: 'plan_region' | 'global';
  regionCode?: string;
  planId?: string;
};

export type ResolvedPayoutFeeSettings = {
  payoutFeeMode: PlatformFeeMode;
  payoutFeeFixed: number;
  payoutFeePercent: number;
  currency: string;
  source: 'plan_region' | 'global';
  regionCode?: string;
  planId?: string;
};

export type ResolvedPlanPricing = {
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  source: 'plan_region' | 'default';
  regionCode?: string;
};

export type ComputeVendorCommissionArgs = {
  goodsCents: number;
  shipCents: number;
  lineItems?: CommissionLineItem[];
};

function readPlanDefaults(plan: Record<string, unknown>): ResolvedPlanPricing {
  return {
    priceMonthly: Math.max(0, Number(plan.priceMonthly ?? 0)),
    priceYearly: Math.max(0, Number(plan.priceYearly ?? 0)),
    currency:
      String(plan.currency ?? 'CAD')
        .trim()
        .toUpperCase() || 'CAD',
    source: 'default',
  };
}

function mapRegionPricingRow(
  row: PlanRegionPricingModel,
): Omit<ResolvedPlanPricing, 'source' | 'regionCode'> | null {
  const regionCode = String(row.regionCode ?? '')
    .trim()
    .toUpperCase();
  if (!regionCode) return null;
  return {
    priceMonthly: Math.max(0, Number(row.priceMonthly ?? 0)),
    priceYearly: Math.max(0, Number(row.priceYearly ?? 0)),
    currency:
      String(row.currency ?? 'CAD')
        .trim()
        .toUpperCase() || 'CAD',
  };
}

function mapRegionFeeRow(
  row: PlanRegionOrderCommissionModel,
  mapFields: (
    mode: PlatformFeeMode,
    fixed: number,
    percent: number,
  ) => Record<string, unknown> | null,
): Record<string, unknown> | null {
  const regionCode = String(row.regionCode ?? '')
    .trim()
    .toUpperCase();
  if (!regionCode) return null;
  const config = orderCommissionConfigFromRow(
    row as unknown as Record<string, unknown>,
  );
  const hasTiers = config.tiers.length > 0;
  const hasFallback =
    (config.fallbackMode === 'fixed' && config.fallbackFixed > 0) ||
    (config.fallbackMode === 'percent' && config.fallbackPercent > 0);
  if (!hasTiers && !hasFallback) return null;
  if (hasTiers) {
    return mapFields(
      config.fallbackMode,
      config.fallbackFixed,
      config.fallbackPercent,
    );
  }
  const mode = config.fallbackMode;
  const fixed = config.fallbackFixed;
  const percent = config.fallbackPercent;
  if (mode === 'fixed' && fixed <= 0) return null;
  if (mode === 'percent' && percent <= 0) return null;
  return mapFields(mode, fixed, percent);
}

function mapPayoutFeeRow(
  row: PlanRegionOrderCommissionModel,
): Omit<
  ResolvedPayoutFeeSettings,
  'currency' | 'source' | 'regionCode' | 'planId'
> | null {
  const mapped = mapRegionFeeRow(row, (mode, fixed, percent) => ({
    payoutFeeMode: mode,
    payoutFeeFixed: mode === 'fixed' ? fixed : 0,
    payoutFeePercent: mode === 'percent' ? percent : 0,
  }));
  return mapped as Omit<
    ResolvedPayoutFeeSettings,
    'currency' | 'source' | 'regionCode' | 'planId'
  > | null;
}

export function mapOrderLineItemsToCommissionLines(
  items: OrdeLineItem[] | undefined,
  currency: string,
): CommissionLineItem[] {
  if (!Array.isArray(items) || !items.length) return [];
  const factor = stripeAmountFactor(currency);
  const out: CommissionLineItem[] = [];
  for (const item of items) {
    const itemType = String(item.itemType ?? '');
    if (
      itemType !== CartItemTypeEnum.PRODUCT &&
      itemType !== CartItemTypeEnum.DRINK &&
      itemType !== CartItemTypeEnum.OFFER &&
      itemType !== CartItemTypeEnum.PRODUCT_EXTRA
    ) {
      continue;
    }
    const unitPrice = Math.max(0, Number(item.price ?? 0));
    const quantity = Math.max(1, Math.round(Number(item.quantity ?? 1)));
    const lineTotalMinor =
      factor >= 100
        ? toStripeMinorUnits(unitPrice * quantity, currency)
        : Math.round(unitPrice * quantity);
    if (lineTotalMinor < 1) continue;
    out.push({ unitPrice, quantity, lineTotalMinor });
  }
  return out;
}

@Injectable()
export class SubscriptionPlanOrderCommissionService {
  constructor(
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(VendorSubscriptionModel.name)
    private readonly vendorSubModel: Model<VendorSubscriptionModel>,
    @InjectModel(SubscriptionPlanModel.name)
    private readonly planModel: Model<SubscriptionPlanModel>,
    private readonly platformFees: PlatformFeesService,
    private readonly supportedCountries: SupportedCountriesService,
  ) {}

  async resolveActivePlanIdForStore(storeId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(storeId)) return null;
    const storeOid = new Types.ObjectId(storeId);
    const rows = await this.vendorSubModel
      .find({ store: storeOid, status: 'ACTIVE' })
      .select('plan endsAt createdAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const nowMs = Date.now();
    let best: { planId: string; endsAtMs: number; createdAtMs: number } | null =
      null;

    const toMs = (raw: unknown): number => {
      const t =
        raw instanceof Date
          ? raw.getTime()
          : new Date(String(raw ?? '')).getTime();
      return Number.isFinite(t) ? t : Number.MIN_SAFE_INTEGER;
    };

    for (const row of rows as Record<string, unknown>[]) {
      const planRaw = row.plan;
      const planId = planRaw ? String(planRaw) : '';
      if (!Types.ObjectId.isValid(planId)) continue;
      const endsAtMs = toMs(row.endsAt);
      const createdAtMs = toMs(row.createdAt);
      const current = { planId, endsAtMs, createdAtMs };
      if (!best) {
        best = current;
        continue;
      }
      const bestValid = best.endsAtMs > nowMs;
      const currentValid = endsAtMs > nowMs;
      if (currentValid && !bestValid) {
        best = current;
        continue;
      }
      if (currentValid === bestValid && createdAtMs > best.createdAtMs) {
        best = current;
      }
    }

    return best?.planId ?? null;
  }

  async resolveStoreRegionCode(storeId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(storeId)) return null;
    const store = await this.storeModel
      .findById(storeId)
      .select('region address.countryCode')
      .lean()
      .exec();
    if (!store) return null;
    const address = store.address as { countryCode?: string } | undefined;
    return (
      normalizeCountryCode(store.region) ||
      normalizeCountryCode(address?.countryCode) ||
      null
    );
  }

  resolveOrderCommissionFromPlanRow(
    entry: PlanRegionOrderCommissionModel | Record<string, unknown> | undefined,
    currency: string,
    meta: { source: 'plan_region' | 'global'; regionCode?: string; planId?: string },
  ): ResolvedOrderCommissionSettings {
    return {
      config: orderCommissionConfigFromRow(
        entry as unknown as Record<string, unknown>,
      ),
      currency,
      ...meta,
    };
  }

  async resolveOrderCommissionForPlanRegion(
    plan: Record<string, unknown>,
    regionCode: string | null | undefined,
  ): Promise<ResolvedOrderCommissionSettings | null> {
    const code = String(regionCode ?? '')
      .trim()
      .toUpperCase();
    if (!code) return null;
    const rows = (
      plan as { orderCommissionsByRegion?: PlanRegionOrderCommissionModel[] }
    )?.orderCommissionsByRegion;
    const entry = Array.isArray(rows)
      ? rows.find(
          (r) =>
            String(r.regionCode ?? '')
              .trim()
              .toUpperCase() === code,
        )
      : undefined;
    if (!entry) return null;
    const config = orderCommissionConfigFromRow(
      entry as unknown as Record<string, unknown>,
    );
    const hasTiers = config.tiers.length > 0;
    const hasFallback =
      (config.fallbackMode === 'fixed' && config.fallbackFixed > 0) ||
      (config.fallbackMode === 'percent' && config.fallbackPercent > 0);
    if (!hasTiers && !hasFallback) return null;
    const currency =
      (await this.supportedCountries.getCurrency(code)) ?? 'CAD';
    return {
      config,
      currency,
      source: 'plan_region',
      regionCode: code,
      planId: String(plan.id ?? plan._id ?? ''),
    };
  }

  async resolveOrderCommissionForStore(
    storeId: string,
  ): Promise<ResolvedOrderCommissionSettings> {
    const regionCode = await this.resolveStoreRegionCode(storeId);
    const planId = await this.resolveActivePlanIdForStore(storeId);

    if (planId && regionCode) {
      const plan = await this.planModel
        .findById(planId)
        .select('orderCommissionsByRegion')
        .lean()
        .exec();
      const resolved = await this.resolveOrderCommissionForPlanRegion(
        plan as Record<string, unknown>,
        regionCode,
      );
      if (resolved) {
        return { ...resolved, planId };
      }
    }

    const global = await this.platformFees.getGlobalOrderCommissionSettings();
    const currency =
      (regionCode
        ? await this.supportedCountries.getCurrency(regionCode)
        : null) ??
      global.currency ??
      'CAD';

    return {
      config: global.config,
      currency,
      source: 'global',
      regionCode: regionCode ?? undefined,
      planId: planId ?? undefined,
    };
  }

  computeVendorCommissionSplit(
    settings: ResolvedOrderCommissionSettings,
    args: ComputeVendorCommissionArgs,
  ): VendorTransferSplit {
    const goods = Math.max(0, Math.round(args.goodsCents));
    const ship = Math.max(0, Math.round(args.shipCents));
    const gross = goods + ship;
    const meta = computeOrderCommissionCents({
      goodsMinor: goods,
      shipMinor: ship,
      lineItems: args.lineItems,
      config: settings.config,
      currency: settings.currency,
    });
    return this.toVendorTransferSplit(gross, meta);
  }

  private toVendorTransferSplit(
    grossCents: number,
    meta: OrderCommissionSplitMeta,
  ): VendorTransferSplit {
    const gross = Math.max(0, Math.round(grossCents));
    const platformFeeCents = Math.max(
      0,
      Math.min(meta.platformFeeCents, gross),
    );
    return {
      grossCents: gross,
      platformFeeCents,
      transferCents: gross - platformFeeCents,
      feeMode: meta.feeMode === 'tiered' ? 'percent' : meta.feeMode,
      feePercent: meta.feePercent,
      feeFixedCad: meta.feeFixedCad,
    };
  }

  async computeVendorTransferSplitForStore(
    storeId: string,
    amounts: {
      goodsCents: number;
      shipCents: number;
      lineItems?: CommissionLineItem[];
    },
  ): Promise<VendorTransferSplit> {
    const settings = await this.resolveOrderCommissionForStore(storeId);
    return this.computeVendorCommissionSplit(settings, {
      goodsCents: Math.max(0, Math.round(amounts.goodsCents)),
      shipCents: Math.max(0, Math.round(amounts.shipCents)),
      lineItems: amounts.lineItems,
    });
  }

  async computeVendorCommissionForStore(
    storeId: string,
    args: ComputeVendorCommissionArgs,
  ): Promise<VendorTransferSplit> {
    const settings = await this.resolveOrderCommissionForStore(storeId);
    return this.computeVendorCommissionSplit(settings, args);
  }

  async resolvePayoutFeeForStore(
    storeId: string,
  ): Promise<ResolvedPayoutFeeSettings> {
    const regionCode = await this.resolveStoreRegionCode(storeId);
    const planId = await this.resolveActivePlanIdForStore(storeId);

    if (planId && regionCode) {
      const plan = await this.planModel
        .findById(planId)
        .select('payoutFeesByRegion')
        .lean()
        .exec();
      const rows = (
        plan as { payoutFeesByRegion?: PlanRegionOrderCommissionModel[] }
      )?.payoutFeesByRegion;
      const entry = Array.isArray(rows)
        ? rows.find(
            (r) =>
              String(r.regionCode ?? '')
                .trim()
                .toUpperCase() === regionCode,
          )
        : undefined;
      if (entry) {
        const mapped = mapPayoutFeeRow(entry);
        if (mapped) {
          const currency =
            (await this.supportedCountries.getCurrency(regionCode)) ?? 'CAD';
          return {
            ...mapped,
            currency,
            source: 'plan_region',
            regionCode,
            planId,
          };
        }
      }
    }

    const global = await this.platformFees.getGlobalPayoutFeeSettings();
    const currency =
      (regionCode
        ? await this.supportedCountries.getCurrency(regionCode)
        : null) ??
      global.currency ??
      'CAD';

    return {
      payoutFeeMode: global.payoutFeeMode,
      payoutFeeFixed: global.payoutFeeFixed,
      payoutFeePercent: global.payoutFeePercent,
      currency,
      source: 'global',
      regionCode: regionCode ?? undefined,
      planId: planId ?? undefined,
    };
  }

  async computePayoutFeeSplitForStore(
    storeId: string,
    grossCents: number,
  ): Promise<PayoutFeeSplit> {
    const settings = await this.resolvePayoutFeeForStore(storeId);
    return computePayoutFeeSplit(
      grossCents,
      {
        payoutFeeMode: settings.payoutFeeMode,
        payoutFeeFixed: settings.payoutFeeFixed,
        payoutFeePercent: settings.payoutFeePercent,
      },
      settings.currency,
    );
  }

  async resolveEffectiveOrderCommissionForPlan(
    plan: Record<string, unknown>,
    regionCode: string | null | undefined,
  ): Promise<ResolvedOrderCommissionSettings> {
    const fromPlan = await this.resolveOrderCommissionForPlanRegion(
      plan,
      regionCode,
    );
    if (fromPlan) return fromPlan;

    const global = await this.platformFees.getGlobalOrderCommissionSettings();
    const code = String(regionCode ?? '')
      .trim()
      .toUpperCase();
    const currency =
      (code ? await this.supportedCountries.getCurrency(code) : null) ??
      global.currency;

    return {
      config: global.config,
      currency,
      source: 'global',
      regionCode: code || undefined,
      planId: String(plan.id ?? plan._id ?? ''),
    };
  }

  resolvePlanPricing(
    plan: Record<string, unknown>,
    regionCode?: string | null,
  ): ResolvedPlanPricing {
    const defaults = readPlanDefaults(plan);
    const code = String(regionCode ?? '')
      .trim()
      .toUpperCase();
    if (!code) return defaults;

    const rows = (
      plan as { pricingByRegion?: PlanRegionPricingModel[] }
    )?.pricingByRegion;
    const entry = Array.isArray(rows)
      ? rows.find(
          (r) =>
            String(r.regionCode ?? '')
              .trim()
              .toUpperCase() === code,
        )
      : undefined;
    if (!entry) return { ...defaults, regionCode: code };

    const mapped = mapRegionPricingRow(entry);
    if (!mapped) return { ...defaults, regionCode: code };

    return {
      ...mapped,
      source: 'plan_region',
      regionCode: code,
    };
  }

  async resolvePlanPricingForStore(
    storeId: string,
    plan: Record<string, unknown>,
  ): Promise<ResolvedPlanPricing> {
    const regionCode = await this.resolveStoreRegionCode(storeId);
    return this.resolvePlanPricing(plan, regionCode);
  }
}
