import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import {
  computeVendorTransferSplit,
  PlatformFeesService,
  VendorTransferSplit,
} from '@modules/platform-fees/platform-fees.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PlanRegionOrderCommissionModel } from '@schemas/plan-region-order-commission.schema';
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

function mapCommissionRow(
  row: PlanRegionOrderCommissionModel,
): Omit<
  ResolvedOrderCommissionSettings,
  'currency' | 'source' | 'regionCode' | 'planId'
> | null {
  const regionCode = String(row.regionCode ?? '')
    .trim()
    .toUpperCase();
  if (!regionCode) return null;
  const mode: PlatformFeeMode = row.mode === 'fixed' ? 'fixed' : 'percent';
  const fixed = Math.max(0, Number(row.fixed ?? 0));
  const percent = Math.max(0, Number(row.percent ?? 0));
  if (mode === 'fixed' && fixed <= 0) return null;
  if (mode === 'percent' && percent <= 0) return null;
  return {
    platformOrderFeeMode: mode,
    platformOrderFeeFixed: mode === 'fixed' ? fixed : 0,
    platformOrderFeePercent: mode === 'percent' ? percent : 0,
  };
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
}
