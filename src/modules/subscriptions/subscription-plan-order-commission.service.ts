import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import {
  computePayoutFeeSplit,
  computeVendorTransferSplit,
  PlatformFeesService,
  PayoutFeeSplit,
  VendorTransferSplit,
} from '@modules/platform-fees/platform-fees.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PlanRegionOrderCommissionModel } from '@schemas/plan-region-order-commission.schema';
import { PlanRegionPricingModel } from '@schemas/plan-region-pricing.schema';
import { PlatformFeeMode } from '@schemas/platform-fees-settings.schema';
import { StoreModel } from '@schemas/store.schema';
import { SubscriptionPlanModel } from '@schemas/subscription-plan.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { Model, Types } from 'mongoose';

export type ResolvedOrderCommissionSettings = {
  platformOrderFeeMode: PlatformFeeMode;
  platformOrderFeeFixed: number;
  platformOrderFeePercent: number;
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
  const mode: PlatformFeeMode = row.mode === 'fixed' ? 'fixed' : 'percent';
  const fixed = Math.max(0, Number(row.fixed ?? 0));
  const percent = Math.max(0, Number(row.percent ?? 0));
  if (mode === 'fixed' && fixed <= 0) return null;
  if (mode === 'percent' && percent <= 0) return null;
  return mapFields(mode, fixed, percent);
}

function mapCommissionRow(
  row: PlanRegionOrderCommissionModel,
): Omit<
  ResolvedOrderCommissionSettings,
  'currency' | 'source' | 'regionCode' | 'planId'
> | null {
  const mapped = mapRegionFeeRow(row, (mode, fixed, percent) => ({
    platformOrderFeeMode: mode,
    platformOrderFeeFixed: mode === 'fixed' ? fixed : 0,
    platformOrderFeePercent: mode === 'percent' ? percent : 0,
  }));
  return mapped as Omit<
    ResolvedOrderCommissionSettings,
    'currency' | 'source' | 'regionCode' | 'planId'
  > | null;
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
      const rows = (
        plan as { orderCommissionsByRegion?: PlanRegionOrderCommissionModel[] }
      )?.orderCommissionsByRegion;
      const entry = Array.isArray(rows)
        ? rows.find(
            (r) =>
              String(r.regionCode ?? '')
                .trim()
                .toUpperCase() === regionCode,
          )
        : undefined;
      if (entry) {
        const mapped = mapCommissionRow(entry);
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

    const global = await this.platformFees.getGlobalOrderCommissionSettings();
    const currency =
      (regionCode
        ? await this.supportedCountries.getCurrency(regionCode)
        : null) ??
      global.currency ??
      'CAD';

    return {
      platformOrderFeeMode: global.platformOrderFeeMode,
      platformOrderFeeFixed: global.platformOrderFeeFixed,
      platformOrderFeePercent: global.platformOrderFeePercent,
      currency,
      source: 'global',
      regionCode: regionCode ?? undefined,
      planId: planId ?? undefined,
    };
  }

  async computeVendorTransferSplitForStore(
    storeId: string,
    grossCents: number,
  ): Promise<VendorTransferSplit> {
    const settings = await this.resolveOrderCommissionForStore(storeId);
    return computeVendorTransferSplit(
      grossCents,
      {
        platformOrderFeeMode: settings.platformOrderFeeMode,
        platformOrderFeeFixed: settings.platformOrderFeeFixed,
        platformOrderFeePercent: settings.platformOrderFeePercent,
      },
      settings.currency,
    );
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
