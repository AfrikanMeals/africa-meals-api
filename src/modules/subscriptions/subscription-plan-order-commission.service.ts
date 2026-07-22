import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import {
  computePayoutFeeSplit,
  computeVendorTransferSplit,
  PlatformFeesService,
  PayoutFeeSplit,
  VendorTransferSplit,
} from '@modules/platform-fees/platform-fees.service';
import {
  applyCommissionMarkupToPriceComponents,
  CommissionLineItem,
  CommissionRetrieveStrategy,
  computeOrderCommissionCents,
  computeUnitCommission,
  CustomerPriceComponents,
  normalizeCommissionRetrieveStrategy,
  orderCommissionConfigFromRow,
  OrderCommissionConfig,
  OrderCommissionSplitMeta,
  parseOptionalCommissionStrategy,
  resolveCustomerUnitPrice,
  resolveEffectiveCommissionStrategy,
  reverseCommissionMarkup,
  markupCatalogListUnitPrices,
  markupCatalogRowComponentPrices,
  sumVendorCustomizationExtras,
  UnitCommissionBreakdown,
} from '@modules/platform-fees/platform-order-commission.util';
import { ProductModel } from '@schemas/product.schema';
import { DrinkModel } from '@schemas/drink.schema';
import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
  storeStrategy: CommissionRetrieveStrategy = 'on_payout',
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
    const itemStrategy = parseOptionalCommissionStrategy(
      (item as { commissionRetrieveStrategy?: string })
        .commissionRetrieveStrategy,
    );
    out.push({
      unitPrice,
      quantity,
      lineTotalMinor,
      strategy: resolveEffectiveCommissionStrategy(itemStrategy, storeStrategy),
    });
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
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    @InjectModel(DrinkModel.name)
    private readonly drinkModel: Model<DrinkModel>,
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
    // Devise région même si inactive (getCurrency filtre active:true → CAD à tort).
    const currency =
      (await this.supportedCountries.getCountryCurrency(code)) || 'CAD';
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
    // Même règle que le simulateur / catalogue : devise pays sans filtre active.
    const currency =
      (regionCode
        ? await this.supportedCountries.getCountryCurrency(regionCode)
        : null) ||
      global.currency ||
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

  async getCommissionRetrieveStrategyForStore(
    storeId: string,
  ): Promise<CommissionRetrieveStrategy> {
    if (!Types.ObjectId.isValid(storeId)) return 'on_payout';
    const store = await this.storeModel
      .findById(storeId)
      .select('commissionRetrieveStrategy')
      .lean()
      .exec();
    return normalizeCommissionRetrieveStrategy(
      (store as { commissionRetrieveStrategy?: string } | null)
        ?.commissionRetrieveStrategy,
    );
  }

  /**
   * Priorité : item → boutique → `on_payout`.
   * `itemStrategy` explicite (`on_payout` | `add_to_price`) prime sur la boutique.
   */
  async resolveEffectiveCommissionStrategyForItem(
    storeId: string,
    itemStrategy?: CommissionRetrieveStrategy | null,
  ): Promise<CommissionRetrieveStrategy> {
    const storeStrategy =
      await this.getCommissionRetrieveStrategyForStore(storeId);
    return resolveEffectiveCommissionStrategy(itemStrategy, storeStrategy);
  }

  async resolveEffectiveStrategyForCatalogItem(
    storeId: string,
    itemType: 'product' | 'drink',
    entityId: string,
  ): Promise<CommissionRetrieveStrategy> {
    let itemStrategy: CommissionRetrieveStrategy | null = null;
    if (Types.ObjectId.isValid(entityId)) {
      if (itemType === 'product') {
        const product = await this.productModel
          .findById(entityId)
          .select('commissionRetrieveStrategy')
          .lean()
          .exec();
        itemStrategy = parseOptionalCommissionStrategy(
          (product as { commissionRetrieveStrategy?: string } | null)
            ?.commissionRetrieveStrategy,
        );
      } else {
        const drink = await this.drinkModel
          .findById(entityId)
          .select('commissionRetrieveStrategy')
          .lean()
          .exec();
        itemStrategy = parseOptionalCommissionStrategy(
          (drink as { commissionRetrieveStrategy?: string } | null)
            ?.commissionRetrieveStrategy,
        );
      }
    }
    return this.resolveEffectiveCommissionStrategyForItem(
      storeId,
      itemStrategy,
    );
  }

  async previewUnitCommissionForStore(
    storeId: string,
    vendorPrice: number,
    itemStrategy?: CommissionRetrieveStrategy | null,
  ): Promise<
    UnitCommissionBreakdown & {
      strategy: CommissionRetrieveStrategy;
      currency: string;
      source: string;
      strategySource: 'item' | 'store' | 'default';
      itemStrategy: CommissionRetrieveStrategy | null;
      storeStrategy: CommissionRetrieveStrategy;
    }
  > {
    const settings = await this.resolveOrderCommissionForStore(storeId);
    const storeRaw = Types.ObjectId.isValid(storeId)
      ? await this.storeModel
          .findById(storeId)
          .select('commissionRetrieveStrategy')
          .lean()
          .exec()
      : null;
    const storeExplicit = parseOptionalCommissionStrategy(
      (storeRaw as { commissionRetrieveStrategy?: string } | null)
        ?.commissionRetrieveStrategy,
    );
    const storeStrategy = storeExplicit ?? ('on_payout' as const);
    const explicitItem = parseOptionalCommissionStrategy(itemStrategy);
    const strategy = resolveEffectiveCommissionStrategy(
      explicitItem,
      storeExplicit,
    );
    const strategySource: 'item' | 'store' | 'default' =
      explicitItem != null ? 'item' : storeExplicit != null ? 'store' : 'default';
    const breakdown = computeUnitCommission(
      vendorPrice,
      settings.config,
      settings.currency,
    );
    return {
      ...breakdown,
      customerPrice:
        strategy === 'add_to_price'
          ? breakdown.customerPrice
          : breakdown.vendorPrice,
      strategy,
      currency: settings.currency,
      source: settings.source,
      strategySource,
      itemStrategy: explicitItem,
      storeStrategy,
    };
  }

  async resolveCustomerUnitPriceForStore(
    storeId: string,
    vendorPrice: number,
    itemStrategy?: CommissionRetrieveStrategy | null,
  ): Promise<number> {
    const settings = await this.resolveOrderCommissionForStore(storeId);
    const strategy = await this.resolveEffectiveCommissionStrategyForItem(
      storeId,
      itemStrategy,
    );
    return resolveCustomerUnitPrice(
      vendorPrice,
      settings.config,
      settings.currency,
      strategy,
    );
  }

  /**
   * Majore `price` / `discountPrice` (ou `priceCad`) sur des lignes catalogue
   * publiques quand la stratégie effective est `add_to_price`.
   * Batch par boutique (1 résolution commission + 1 lecture stratégie / store).
   */
  async applyCustomerCatalogListPricing(
    rows: Array<Record<string, unknown>>,
    opts?: {
      /** Clé du prix principal (défaut `price`). */
      priceKey?: 'price' | 'priceCad';
      /** Clé promo ; `null` pour ignorer (défaut `discountPrice` si priceKey=price). */
      discountKey?: 'discountPrice' | null;
      getStoreId?: (row: Record<string, unknown>) => string;
      getItemStrategy?: (
        row: Record<string, unknown>,
      ) => CommissionRetrieveStrategy | null;
    },
  ): Promise<void> {
    if (!rows.length) return;
    const priceKey = opts?.priceKey ?? 'price';
    const discountKey =
      opts?.discountKey !== undefined
        ? opts.discountKey
        : priceKey === 'price'
          ? 'discountPrice'
          : null;
    const getStoreId =
      opts?.getStoreId ??
      ((row: Record<string, unknown>) => {
        const st = row['store'] as Record<string, unknown> | null | undefined;
        if (st != null && typeof st === 'object') {
          const id = st['id'] ?? st['_id'];
          if (id != null && String(id).trim()) return String(id).trim();
        }
        const sid = row['storeId'] ?? row['store_id'];
        return sid != null ? String(sid).trim() : '';
      });
    const getItemStrategy =
      opts?.getItemStrategy ??
      ((row: Record<string, unknown>) =>
        parseOptionalCommissionStrategy(
          row['commissionRetrieveStrategy'] ??
            row['commission_retrieve_strategy'],
        ));

    const storeIds = [
      ...new Set(
        rows
          .map((r) => getStoreId(r))
          .filter((id) => id && Types.ObjectId.isValid(id)),
      ),
    ];
    if (!storeIds.length) return;

    const storeOids = storeIds.map((id) => new Types.ObjectId(id));
    const storeDocs = await this.storeModel
      .find({ _id: { $in: storeOids } })
      .select('commissionRetrieveStrategy')
      .lean()
      .exec();
    const storeStrategyById = new Map<
      string,
      CommissionRetrieveStrategy | null
    >();
    for (const doc of storeDocs) {
      const raw = doc as unknown as {
        _id?: Types.ObjectId | string;
        commissionRetrieveStrategy?: string;
      };
      storeStrategyById.set(
        String(raw._id),
        parseOptionalCommissionStrategy(raw.commissionRetrieveStrategy),
      );
    }

    const settingsById = new Map<
      string,
      Awaited<ReturnType<SubscriptionPlanOrderCommissionService['resolveOrderCommissionForStore']>>
    >();
    await Promise.all(
      storeIds.map(async (id) => {
        settingsById.set(id, await this.resolveOrderCommissionForStore(id));
      }),
    );

    for (const row of rows) {
      const storeId = getStoreId(row);
      if (!storeId || !settingsById.has(storeId)) continue;
      const settings = settingsById.get(storeId)!;
      const strategy = resolveEffectiveCommissionStrategy(
        getItemStrategy(row),
        storeStrategyById.get(storeId) ?? null,
      );
      const vendorPrice = Number(row[priceKey] ?? 0);
      const vendorDiscount =
        discountKey != null ? Number(row[discountKey] ?? 0) : 0;
      const marked = markupCatalogListUnitPrices({
        vendorPrice,
        vendorDiscountPrice: vendorDiscount,
        config: settings.config,
        currency: settings.currency,
        strategy,
      });
      row[priceKey] = marked.price;
      if (discountKey != null) {
        row[discountKey] = marked.discountPrice;
      }
      // Variantes / compléments / suppléments (menu boutique, détail listé, etc.)
      markupCatalogRowComponentPrices({
        row,
        config: settings.config,
        currency: settings.currency,
        strategy,
        vendorBasePrice: vendorPrice,
      });
    }
  }

  /**
   * Prix client pour une ligne produit : base + compléments (priceDelta) + suppléments.
   * La commission `add_to_price` s’applique sur le total vendeur de la ligne.
   */
  async resolveCustomerLineUnitPriceForStore(
    storeId: string,
    vendorBasePrice: number,
    customization?: {
      complements?: Array<{ options?: Array<{ priceDelta?: number }> }>;
      supplements?: Array<{ price?: number }>;
    },
    itemStrategy?: CommissionRetrieveStrategy | null,
  ): Promise<number> {
    const extras = sumVendorCustomizationExtras(customization ?? {});
    const vendorTotal = Math.max(0, Number(vendorBasePrice) || 0) + extras;
    return this.resolveCustomerUnitPriceForStore(
      storeId,
      vendorTotal,
      itemStrategy,
    );
  }

  async applyCustomerPricingToProductComponents(
    storeId: string,
    args: {
      vendorBase: number;
      complements?: Array<{
        options?: Array<{ label: string; priceDelta: number; isDefault?: boolean }>;
        [key: string]: unknown;
      }>;
      supplements?: Array<{ name: string; price: number; [key: string]: unknown }>;
      itemStrategy?: CommissionRetrieveStrategy | null;
    },
  ): Promise<{
    strategy: CommissionRetrieveStrategy;
    currency: string;
    components: CustomerPriceComponents;
    complements: Array<Record<string, unknown>>;
    supplements: Array<Record<string, unknown>>;
    customerBase: number;
  }> {
    const settings = await this.resolveOrderCommissionForStore(storeId);
    const strategy = await this.resolveEffectiveCommissionStrategyForItem(
      storeId,
      args.itemStrategy,
    );
    const complements = args.complements ?? [];
    const supplements = args.supplements ?? [];
    const extras: number[] = [];
    const extraMeta: Array<{ kind: 'complement'; gi: number; oi: number } | { kind: 'supplement'; si: number }> = [];

    complements.forEach((g, gi) => {
      (g.options ?? []).forEach((o, oi) => {
        extras.push(Math.max(0, Number(o.priceDelta) || 0));
        extraMeta.push({ kind: 'complement', gi, oi });
      });
    });
    supplements.forEach((s, si) => {
      extras.push(Math.max(0, Number(s.price) || 0));
      extraMeta.push({ kind: 'supplement', si });
    });

    const components = applyCommissionMarkupToPriceComponents(
      args.vendorBase,
      extras,
      settings.config,
      settings.currency,
      strategy,
    );

    const nextComplements = complements.map((g) => ({
      ...g,
      options: (g.options ?? []).map((o) => ({ ...o })),
    }));
    const nextSupplements = supplements.map((s) => ({ ...s }));

    extraMeta.forEach((meta, idx) => {
      const customerExtra = components.customerExtras[idx] ?? 0;
      if (meta.kind === 'complement') {
        const opt = nextComplements[meta.gi]?.options?.[meta.oi];
        if (opt) opt.priceDelta = customerExtra;
      } else {
        const row = nextSupplements[meta.si];
        if (row) row.price = customerExtra;
      }
    });

    return {
      strategy,
      currency: settings.currency,
      components,
      complements: nextComplements,
      supplements: nextSupplements,
      customerBase: components.customerBase,
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
    const storeStrategy =
      await this.getCommissionRetrieveStrategyForStore(storeId);
    const goodsCents = Math.max(0, Math.round(amounts.goodsCents));
    const shipCents = Math.max(0, Math.round(amounts.shipCents));
    const lines = amounts.lineItems ?? [];

    if (lines.length > 0) {
      let platformFeeOnGoods = 0;
      let transferOnGoods = 0;
      const factor = stripeAmountFactor(settings.currency);

      for (const line of lines) {
        const qty = Math.max(0, Math.round(line.quantity));
        const lineMinor = Math.max(0, Math.round(line.lineTotalMinor));
        if (qty < 1 || lineMinor < 1) continue;
        const strategy = resolveEffectiveCommissionStrategy(
          line.strategy,
          storeStrategy,
        );
        const customerUnitDisplay =
          line.unitPrice > 0
            ? line.unitPrice
            : factor > 1
              ? lineMinor / qty / factor
              : lineMinor / qty;

        if (strategy === 'add_to_price') {
          const vendorUnit = reverseCommissionMarkup(
            customerUnitDisplay,
            settings.config,
            settings.currency,
          );
          const vendorLineMinor =
            toStripeMinorUnits(vendorUnit, settings.currency) * qty;
          const cappedVendor = Math.min(vendorLineMinor, lineMinor);
          transferOnGoods += cappedVendor;
          platformFeeOnGoods += lineMinor - cappedVendor;
        } else {
          const meta = computeOrderCommissionCents({
            goodsMinor: lineMinor,
            shipMinor: 0,
            lineItems: [
              {
                unitPrice: customerUnitDisplay,
                quantity: qty,
                lineTotalMinor: lineMinor,
              },
            ],
            config: settings.config,
            currency: settings.currency,
          });
          const fee = Math.min(meta.platformFeeCents, lineMinor);
          platformFeeOnGoods += fee;
          transferOnGoods += lineMinor - fee;
        }
      }

      const shipSplit = this.computeVendorCommissionSplit(settings, {
        goodsCents: 0,
        shipCents,
      });
      const platformFeeCents =
        platformFeeOnGoods + shipSplit.platformFeeCents;
      const gross = goodsCents + shipCents;
      const feeCapped = Math.min(platformFeeCents, gross);
      return {
        grossCents: gross,
        platformFeeCents: feeCapped,
        transferCents: Math.max(0, gross - feeCapped),
        feeMode: 'percent',
        feePercent: settings.config.fallbackPercent,
        feeFixedCad: settings.config.fallbackFixed,
      };
    }

    return this.computeVendorCommissionSplit(settings, {
      goodsCents,
      shipCents,
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
          // Devise région sans filtre active (fixe payout en unités mineures correctes).
          const currency =
            (await this.supportedCountries.getCountryCurrency(regionCode)) ||
            'CAD';
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
        ? await this.supportedCountries.getCountryCurrency(regionCode)
        : null) ||
      global.currency ||
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
