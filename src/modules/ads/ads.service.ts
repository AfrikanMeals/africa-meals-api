import {
  AdBannerImageJsonDto,
  CreateAdManagementDto,
  isAdLinkActionType,
  PatchAdManagementDto,
} from '@modules/ads/dto/ad-management.dto';
import {
  CampaignItemDto,
  CreateAdCampaignDto,
  PatchAdCampaignDto,
} from '@modules/ads/dto/ad-campaign.dto';
import { UpdateAdPricingDto } from '@modules/ads/dto/ad-pricing.dto';
import { TrackAdEventDto } from '@modules/ads/dto/ad-tracking.dto';
import { TrackAdCampaignEventDto } from '@modules/ads/dto/ad-campaign-tracking.dto';
import {
  pipelineActiveStoresWithStripeOnboarded,
  isStripeConnectOnboardingCompleteUser,
  resolveStoreIdsVisibleOnMobileApp,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { MediasService } from '@modules/medias/medias.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  AdConversionSourceEnum,
  AdEventModel,
  AdEventTypeEnum,
} from '@schemas/ad-event.schema';
import {
  AdCampaignConversionSourceEnum,
  AdCampaignEventModel,
  AdCampaignEventTypeEnum,
} from '@schemas/ad-campaign-event.schema';
import {
  AdCampaignArchiveReasonEnum,
  AdCampaignItemTypeEnum,
  AdCampaignModel,
} from '@schemas/ad-campaign.schema';
import {
  AdPricingSettingsDocument,
  AdPricingSettingsModel,
} from '@schemas/ad-pricing-settings.schema';
import {
  AdCreditPaymentModel,
  AdCreditPaymentStatusEnum,
} from '@schemas/ad-credit-payment.schema';
import {
  AdArchiveReasonEnum,
  AdModel,
  StoreAdActionTypeEnum,
} from '@schemas/ad.schema';
import { DrinkModel } from '@schemas/drink.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

function productRefId(id: string): NonNullable<AdModel['product']> {
  return new Types.ObjectId(id) as unknown as NonNullable<AdModel['product']>;
}

export type AdManagementRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  title: string;
  subtitle: string;
  actionText: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
  actionType: StoreAdActionTypeEnum;
  /** Numéro, e-mail ou URL selon `actionType`. */
  actionTarget: string | null;
  productId: string | null;
  productTitle: string | null;
  archivedAt: string | null;
  archiveReason: AdArchiveReasonEnum | null;
  billingFinalizedAt: string | null;
  billingFinalAmountCad: number;
  createdAt?: string;
  updatedAt?: string;
};

export type AdStatsRecentEvent = {
  eventType: AdEventTypeEnum;
  conversionSource?: AdConversionSourceEnum | null;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
  userFullName: string | null;
  clientInstallId: string | null;
};

export type AdStatsDayBucket = {
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type AdStatsPayload = {
  adId: string;
  impressionsTotal: number;
  clicksTotal: number;
  conversionsTotal: number;
  uniqueUsersImpressions: number;
  uniqueUsersClicks: number;
  uniqueUsersConversions: number;
  uniqueClientDevices: number;
  last7Days: AdStatsDayBucket[];
  recentEvents: AdStatsRecentEvent[];
};

export type AdCampaignStatsRecentEvent = {
  eventType: AdCampaignEventTypeEnum;
  conversionSource?: AdCampaignConversionSourceEnum | null;
  itemType: string;
  itemId: string;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
  userFullName: string | null;
  clientInstallId: string | null;
};

export type AdCampaignStatsDayBucket = {
  date: string;
  impressions: number;
  clicks: number;
  actionClicks: number;
  conversions: number;
};

export type AdCampaignItemPerformance = {
  itemType: string;
  itemId: string;
  title: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctrPercent: number;
  conversionRatePercent: number;
};

export type AdCampaignStatsPayload = {
  campaignId: string;
  impressionsTotal: number;
  clicksTotal: number;
  actionClicksTotal: number;
  conversionsTotal: number;
  uniqueUsersImpressions: number;
  uniqueUsersClicks: number;
  uniqueUsersConversions: number;
  uniqueClientDevices: number;
  last7Days: AdCampaignStatsDayBucket[];
  itemPerformance: AdCampaignItemPerformance[];
  recentEvents: AdCampaignStatsRecentEvent[];
};

export type AdCampaignItemRow = {
  itemType: AdCampaignItemTypeEnum;
  productId: string | null;
  drinkId: string | null;
  title: string;
  imageUrl: string | null;
  priceCad: number;
};

export type AdCampaignManagementRow = {
  id: string;
  storeId: string;
  storeName: string;
  storeProfileImageUrl?: string | null;
  title: string;
  subtitle: string;
  description: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  actionType: StoreAdActionTypeEnum;
  actionText: string;
  actionTarget: string | null;
  items: AdCampaignItemRow[];
  archivedAt?: string | null;
  archiveReason?: AdCampaignArchiveReasonEnum | null;
  billingFinalizedAt?: string | null;
  billingFinalAmountCad?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PublicAdCampaignRow = {
  id: string;
  storeId: string;
  storeName: string;
  storeProfileImageUrl?: string | null;
  title: string;
  subtitle: string;
  description: string;
  startsAt: string;
  endsAt: string;
  actionType: StoreAdActionTypeEnum;
  actionText: string;
  actionTarget: string | null;
  items: AdCampaignItemRow[];
};

export type AdCreditSummaryPayload = {
  currency: string;
  grossDue: number;
  paidTotal: number;
  creditBalance: number;
  banners: {
    impressions: number;
    clicks: number;
    conversions: number;
    due: number;
  };
  campaigns: {
    impressions: number;
    clicks: number;
    actionClicks: number;
    conversions: number;
    due: number;
  };
  stores: Array<{
    storeId: string;
    storeName: string;
    banners: { impressions: number; clicks: number; conversions: number; due: number };
    campaigns: {
      impressions: number;
      clicks: number;
      actionClicks: number;
      conversions: number;
      due: number;
    };
    totalDue: number;
  }>;
  totalDue: number;
};

export type AdPricingPayload = {
  currency: string;
  cpmCad: number;
  cpcCad: number;
  campaignCpmCad: number;
  campaignCpcCad: number;
  campaignActionCad: number;
  conversionCad: number;
  minimumBudgetCad: number;
  updatedAt: string | null;
};

const ADS_PRICING_KEY = 'default';
const AD_CONVERSION_ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const AD_CREDIT_CHECKOUT_METADATA_KIND = 'ad_credit_payment';
const AD_CREDIT_STRIPE_MIN_CAD = 0.5;
const ADS_PRICING_DEFAULTS: Omit<AdPricingPayload, 'updatedAt'> = {
  currency: 'CAD',
  cpmCad: 0,
  cpcCad: 0,
  campaignCpmCad: 0,
  campaignCpcCad: 0,
  campaignActionCad: 0,
  conversionCad: 0,
  minimumBudgetCad: 0,
};

@Injectable()
export class AdsService implements OnModuleInit {
  private static readonly _LIST_TTL_MS = 30_000;
  private _listCache: {
    at: number;
    data: AdModel[];
    stripeFiltered: boolean;
  } | null = null;

  @InjectModel(AdModel.name)
  private readonly adModel: Model<AdModel>;

  @InjectModel(AdEventModel.name)
  private readonly _adEventModel: Model<AdEventModel>;

  @InjectModel(AdCampaignModel.name)
  private readonly _adCampaignModel: Model<AdCampaignModel>;

  @InjectModel(AdCampaignEventModel.name)
  private readonly _adCampaignEventModel: Model<AdCampaignEventModel>;

  @InjectModel(AdPricingSettingsModel.name)
  private readonly _adPricingModel: Model<AdPricingSettingsDocument>;

  @InjectModel(AdCreditPaymentModel.name)
  private readonly _adCreditPaymentModel: Model<AdCreditPaymentModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(DrinkModel.name)
  private readonly _drinkModel: Model<DrinkModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(ConfigService)
  private readonly _config: ConfigService;

  async onModuleInit() {
    await this.seedIfEmpty();
  }

  private invalidateListCache() {
    this._listCache = null;
  }

  private assertVendorOrAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
  }

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private assertVendorStripeConnectReadyForWrites(user: UserModel): void {
    if (user.type !== UserTypeEnum.VENDOR) return;
    if (!isStripeConnectOnboardingCompleteUser(user as unknown as Record<string, unknown>)) {
      throw new ForbiddenException('stripe_connect_required');
    }
  }

  /**
   * Bloque la création de nouvelles Ads tant que le crédit Ads finalisé
   * (bannières/campagnes terminées ou expirées) n'est pas soldé.
   */
  private async assertVendorHasNoUnpaidAdCredit(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.VENDOR) return;
    const credit = await this.getMyAdCredit(user);
    if (Number(credit.totalDue ?? 0) > 0) {
      throw new ForbiddenException('ad_credit_payment_required');
    }
  }

  private stripe(): StripeClient {
    const key = this._config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException('stripe_not_configured');
    }
    return new Stripe(key);
  }

  private adCreditSuccessUrl(): string {
    const configured = this._config
      .get<string>('STRIPE_AD_CREDIT_SUCCESS_URL')
      ?.trim();
    if (configured) {
      return configured.includes('{CHECKOUT_SESSION_ID}')
        ? configured
        : `${configured}${
            configured.includes('?') ? '&' : '?'
          }ad_credit_session_id={CHECKOUT_SESSION_ID}`;
    }
    const adminBase =
      this._config.get<string>('FRONTEND_URL')?.trim() ||
      this._config.get<string>('ADMIN_APP_URL')?.trim() ||
      'http://localhost:3000';
    return `${adminBase.replace(
      /\/$/,
      '',
    )}/?ad_credit_session_id={CHECKOUT_SESSION_ID}`;
  }

  private adCreditCancelUrl(): string {
    const configured = this._config
      .get<string>('STRIPE_AD_CREDIT_CANCEL_URL')
      ?.trim();
    if (configured) return configured;
    const adminBase =
      this._config.get<string>('FRONTEND_URL')?.trim() ||
      this._config.get<string>('ADMIN_APP_URL')?.trim() ||
      'http://localhost:3000';
    return `${adminBase.replace(/\/$/, '')}/?ad_credit_payment=cancel`;
  }

  private async _adCreditPaidTotalCad(ownerId: Types.ObjectId): Promise<number> {
    const rows = await this._adCreditPaymentModel
      .aggregate<{ _id: null; total: number }>([
        {
          $match: {
            owner: ownerId,
            status: AdCreditPaymentStatusEnum.PAID,
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$amountPaidCad' },
          },
        },
      ])
      .exec();
    return Number(rows[0]?.total ?? 0);
  }

  private async _backfillRecentAdCreditPayments(ownerId: Types.ObjectId): Promise<void> {
    let stripe: StripeClient;
    try {
      stripe = this.stripe();
    } catch {
      return;
    }
    const owner = ownerId.toHexString();
    let sessionsData: Array<{
      id: string;
      metadata?: Record<string, string | null | undefined> | null;
      amount_total?: number | null;
      currency?: string | null;
      payment_status?: string | null;
      payment_intent?: string | { id?: string | null } | null;
    }> = [];
    try {
      const sessions = await stripe.checkout.sessions.list({ limit: 25 });
      sessionsData = sessions.data.map((session) => ({
        id: session.id,
        metadata: session.metadata ?? null,
        amount_total: session.amount_total ?? null,
        currency: session.currency ?? null,
        payment_status: session.payment_status ?? null,
        payment_intent: session.payment_intent ?? null,
      }));
    } catch {
      return;
    }
    for (const session of sessionsData) {
      if (session.payment_status !== 'paid') continue;
      const kind = String(session.metadata?.kind ?? '').trim();
      const uid = String(session.metadata?.uid ?? '').trim();
      if (kind !== AD_CREDIT_CHECKOUT_METADATA_KIND || uid !== owner) continue;
      const amountPaidCad = Number(((session.amount_total ?? 0) / 100).toFixed(2));
      if (!Number.isFinite(amountPaidCad) || amountPaidCad <= 0) continue;
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      const currency = String(session.currency ?? 'cad').trim().toUpperCase() || 'CAD';
      await this._adCreditPaymentModel
        .updateOne(
          { stripeCheckoutSessionId: session.id },
          {
            $setOnInsert: {
              owner: ownerId,
              amountPaidCad,
              currency,
              status: AdCreditPaymentStatusEnum.PAID,
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId: paymentIntentId,
              paidAt: new Date(),
            },
          },
          { upsert: true },
        )
        .exec();
    }
  }

  private applyPaidAmountToStoreBreakdown(
    stores: AdCreditSummaryPayload['stores'],
    paidAmountCad: number,
  ): {
    stores: AdCreditSummaryPayload['stores'];
    bannersDue: number;
    campaignsDue: number;
    outstandingDue: number;
    creditBalance: number;
  } {
    const remaining = stores.map((s) => ({
      ...s,
      banners: { ...s.banners },
      campaigns: { ...s.campaigns },
      totalDue: Number(s.totalDue ?? 0),
    }));

    let credit = Math.max(0, Number(paidAmountCad ?? 0));
    for (const row of remaining) {
      if (credit <= 0) break;
      const campaignDue = Math.max(0, Number(row.campaigns.due ?? 0));
      const campaignPaid = Math.min(campaignDue, credit);
      row.campaigns.due = Number((campaignDue - campaignPaid).toFixed(2));
      credit = Number((credit - campaignPaid).toFixed(2));

      if (credit <= 0) {
        row.totalDue = Number((row.campaigns.due + row.banners.due).toFixed(2));
        continue;
      }
      const bannerDue = Math.max(0, Number(row.banners.due ?? 0));
      const bannerPaid = Math.min(bannerDue, credit);
      row.banners.due = Number((bannerDue - bannerPaid).toFixed(2));
      credit = Number((credit - bannerPaid).toFixed(2));

      row.totalDue = Number((row.campaigns.due + row.banners.due).toFixed(2));
    }

    const bannersDue = Number(
      remaining
        .reduce((acc, row) => acc + Number(row.banners.due ?? 0), 0)
        .toFixed(2),
    );
    const campaignsDue = Number(
      remaining
        .reduce((acc, row) => acc + Number(row.campaigns.due ?? 0), 0)
        .toFixed(2),
    );
    const outstandingDue = Number((bannersDue + campaignsDue).toFixed(2));
    return {
      stores: remaining,
      bannersDue,
      campaignsDue,
      outstandingDue,
      creditBalance: Number(Math.max(0, credit).toFixed(2)),
    };
  }

  private async assertCanManageCampaignStore(
    user: UserModel,
    storeId: string,
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN) return;
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
    await this._storeAccess.assertStoreAccess(user, storeId, 'campaigns.manage');
  }

  private async resolveManageableCampaignStoreIds(
    user: UserModel,
  ): Promise<string[]> {
    if (user.type === UserTypeEnum.ADMIN) {
      return [];
    }
    if (user.type !== UserTypeEnum.VENDOR) {
      return [];
    }
    const access = await this._storeAccess.resolveStoreAccess(user);
    return access
      .filter((a) => a.isOwner || a.permissions.includes('campaigns.manage'))
      .map((a) => a.storeId)
      .filter((id) => Types.ObjectId.isValid(id));
  }

  private _toPricingPayload(
    doc: AdPricingSettingsModel &
      Partial<{ updatedAt: Date | string | null }>,
  ): AdPricingPayload {
    const currency = String(doc.currency ?? ADS_PRICING_DEFAULTS.currency)
      .trim()
      .toUpperCase();
    const updatedAt = doc.updatedAt;
    return {
      currency: currency || ADS_PRICING_DEFAULTS.currency,
      cpmCad: Number(doc.cpmCad ?? ADS_PRICING_DEFAULTS.cpmCad),
      cpcCad: Number(doc.cpcCad ?? ADS_PRICING_DEFAULTS.cpcCad),
      campaignCpmCad: Number(
        doc.campaignCpmCad ?? ADS_PRICING_DEFAULTS.campaignCpmCad,
      ),
      campaignCpcCad: Number(
        doc.campaignCpcCad ?? ADS_PRICING_DEFAULTS.campaignCpcCad,
      ),
      campaignActionCad: Number(
        doc.campaignActionCad ?? ADS_PRICING_DEFAULTS.campaignActionCad,
      ),
      conversionCad: Number(
        doc.conversionCad ?? ADS_PRICING_DEFAULTS.conversionCad,
      ),
      minimumBudgetCad: Number(
        doc.minimumBudgetCad ?? ADS_PRICING_DEFAULTS.minimumBudgetCad,
      ),
      updatedAt:
        updatedAt instanceof Date
          ? updatedAt.toISOString()
          : typeof updatedAt === 'string'
          ? updatedAt
          : null,
    };
  }

  private async _ensurePricingDoc(): Promise<AdPricingSettingsModel> {
    const doc = await this._adPricingModel
      .findOneAndUpdate(
        { key: ADS_PRICING_KEY },
        {
          $setOnInsert: {
            key: ADS_PRICING_KEY,
            ...ADS_PRICING_DEFAULTS,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as unknown as AdPricingSettingsModel;
  }

  async getPricing(user: UserModel): Promise<AdPricingPayload> {
    this.assertAdmin(user);
    const doc = await this._ensurePricingDoc();
    return this._toPricingPayload(doc);
  }

  async updatePricing(
    user: UserModel,
    dto: UpdateAdPricingDto,
  ): Promise<AdPricingPayload> {
    this.assertAdmin(user);
    const current = await this._ensurePricingDoc();
    const nextCurrency = String(dto.currency ?? current.currency ?? 'CAD')
      .trim()
      .toUpperCase();
    const cpmCad = Number(dto.cpmCad ?? current.cpmCad ?? 0);
    const cpcCad = Number(dto.cpcCad ?? current.cpcCad ?? 0);
    const campaignCpmCad = Number(
      dto.campaignCpmCad ?? current.campaignCpmCad ?? 0,
    );
    const campaignCpcCad = Number(
      dto.campaignCpcCad ?? current.campaignCpcCad ?? 0,
    );
    const campaignActionCad = Number(
      dto.campaignActionCad ?? current.campaignActionCad ?? 0,
    );
    const conversionCad = Number(dto.conversionCad ?? current.conversionCad ?? 0);
    const minimumBudgetCad = Number(
      dto.minimumBudgetCad ?? current.minimumBudgetCad ?? 0,
    );
    const updated = await this._adPricingModel
      .findOneAndUpdate(
        { key: ADS_PRICING_KEY },
        {
          $set: {
            currency: nextCurrency || 'CAD',
            cpmCad: cpmCad < 0 ? 0 : cpmCad,
            cpcCad: cpcCad < 0 ? 0 : cpcCad,
            campaignCpmCad: campaignCpmCad < 0 ? 0 : campaignCpmCad,
            campaignCpcCad: campaignCpcCad < 0 ? 0 : campaignCpcCad,
            campaignActionCad: campaignActionCad < 0 ? 0 : campaignActionCad,
            conversionCad: conversionCad < 0 ? 0 : conversionCad,
            minimumBudgetCad: minimumBudgetCad < 0 ? 0 : minimumBudgetCad,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toPricingPayload(updated as unknown as AdPricingSettingsModel);
  }

  private _normalizeCampaignItems(items: CampaignItemDto[]): CampaignItemDto[] {
    const out: CampaignItemDto[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      if (it.itemType === AdCampaignItemTypeEnum.PRODUCT && it.productId) {
        const key = `P:${it.productId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ itemType: it.itemType, productId: it.productId });
      } else if (it.itemType === AdCampaignItemTypeEnum.DRINK && it.drinkId) {
        const key = `D:${it.drinkId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ itemType: it.itemType, drinkId: it.drinkId });
      }
    }
    return out;
  }

  private _assertCampaignDateRange(startsAt: Date, endsAt: Date) {
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('invalid_campaign_starts_at');
    }
    if (Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('invalid_campaign_ends_at');
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('invalid_campaign_date_range');
    }
  }

  private async _assertCampaignItemsBelongToStore(
    storeId: string,
    items: CampaignItemDto[],
  ): Promise<void> {
    const normalized = this._normalizeCampaignItems(items);
    if (!normalized.length) {
      throw new BadRequestException('campaign_items_required');
    }
    const productIds = normalized
      .filter((i) => i.itemType === AdCampaignItemTypeEnum.PRODUCT)
      .map((i) => i.productId!)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const drinkIds = normalized
      .filter((i) => i.itemType === AdCampaignItemTypeEnum.DRINK)
      .map((i) => i.drinkId!)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (productIds.length > 0) {
      const count = await this._productModel
        .countDocuments({
          _id: { $in: productIds },
          store: new Types.ObjectId(storeId),
        })
        .exec();
      if (count !== productIds.length) {
        throw new BadRequestException('campaign_product_not_in_store');
      }
    }
    if (drinkIds.length > 0) {
      const count = await this._drinkModel
        .countDocuments({
          _id: { $in: drinkIds },
          store: new Types.ObjectId(storeId),
        })
        .exec();
      if (count !== drinkIds.length) {
        throw new BadRequestException('campaign_drink_not_in_store');
      }
    }
  }

  private _toCampaignRow(
    doc: Record<string, unknown>,
  ): AdCampaignManagementRow {
    const rawStore = doc.store as Record<string, unknown> | undefined | null;
    const storeId = String(rawStore?._id ?? '');
    const storeName = String(rawStore?.name ?? '').trim() || storeId;
    const storeProfileImageUrl = rawStore?.profileImage
      ? String(rawStore.profileImage)
      : null;
    const rawItems = Array.isArray(doc.items)
      ? (doc.items as Record<string, unknown>[])
      : [];
    const items: AdCampaignItemRow[] = rawItems
      .map((it) => {
        const itemType = it.itemType as AdCampaignItemTypeEnum;
        const p = it.product as Record<string, unknown> | undefined | null;
        const d = it.drink as Record<string, unknown> | undefined | null;
        if (itemType === AdCampaignItemTypeEnum.PRODUCT) {
          return {
            itemType,
            productId: p?._id ? String(p._id) : null,
            drinkId: null,
            title: String(p?.title ?? '(produit supprimé)'),
            imageUrl: p?.profileImage ? String(p.profileImage) : null,
            priceCad: Number(p?.price ?? 0),
          };
        }
        return {
          itemType: AdCampaignItemTypeEnum.DRINK,
          productId: null,
          drinkId: d?._id ? String(d._id) : null,
          title: String(d?.name ?? '(boisson supprimée)'),
          imageUrl: d?.imageUrl ? String(d.imageUrl) : null,
          priceCad: Number(d?.priceCad ?? 0),
        };
      })
      .filter((it) => it.productId != null || it.drinkId != null);

    return {
      id: String(doc._id ?? ''),
      storeId,
      storeName,
      storeProfileImageUrl,
      title: String(doc.title ?? ''),
      subtitle: String(doc.subtitle ?? ''),
      description: String(doc.description ?? ''),
      startsAt: new Date(String(doc.startsAt)).toISOString(),
      endsAt: new Date(String(doc.endsAt)).toISOString(),
      isActive: Boolean(doc.isActive),
      actionType:
        (doc.actionType as StoreAdActionTypeEnum) ?? StoreAdActionTypeEnum.SHOP,
      actionText: String(doc.actionText ?? '').trim() || 'Découvrir',
      actionTarget:
        doc.actionTarget != null && String(doc.actionTarget).trim() !== ''
          ? String(doc.actionTarget).trim()
          : null,
      items,
      archivedAt:
        doc.archivedAt instanceof Date
          ? doc.archivedAt.toISOString()
          : doc.archivedAt != null
          ? String(doc.archivedAt)
          : null,
      archiveReason:
        doc.archiveReason != null && String(doc.archiveReason).trim() !== ''
          ? (String(doc.archiveReason).trim().toUpperCase() as AdCampaignArchiveReasonEnum)
          : null,
      billingFinalizedAt:
        doc.billingFinalizedAt instanceof Date
          ? doc.billingFinalizedAt.toISOString()
          : doc.billingFinalizedAt != null
          ? String(doc.billingFinalizedAt)
          : null,
      billingFinalAmountCad: Number(doc.billingFinalAmountCad ?? 0),
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : doc.createdAt != null
          ? String(doc.createdAt)
          : undefined,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : doc.updatedAt != null
          ? String(doc.updatedAt)
          : undefined,
    };
  }

  private async _campaignBillingMetrics(campaignId: Types.ObjectId): Promise<{
    impressions: number;
    clicks: number;
    actionClicks: number;
    conversions: number;
  }> {
    const [impressions, clicks, actionClicks, conversions] = await Promise.all([
      this._adCampaignEventModel.countDocuments({
        campaign: campaignId,
        eventType: AdCampaignEventTypeEnum.IMPRESSION,
      }),
      this._adCampaignEventModel.countDocuments({
        campaign: campaignId,
        eventType: AdCampaignEventTypeEnum.CLICK,
        itemType: { $in: [AdCampaignItemTypeEnum.PRODUCT, AdCampaignItemTypeEnum.DRINK] },
      }),
      this._adCampaignEventModel.countDocuments({
        campaign: campaignId,
        eventType: AdCampaignEventTypeEnum.CLICK,
        itemType: 'STORE_ACTION',
      }),
      this._adCampaignEventModel.countDocuments({
        campaign: campaignId,
        eventType: AdCampaignEventTypeEnum.CONVERSION,
      }),
    ]);
    return { impressions, clicks, actionClicks, conversions };
  }

  private _campaignBillingAmount(
    pricing: AdPricingPayload,
    metrics: { impressions: number; clicks: number; actionClicks: number; conversions: number },
  ): number {
    return (
      (metrics.impressions / 1000) * pricing.campaignCpmCad +
      metrics.clicks * pricing.campaignCpcCad +
      metrics.actionClicks * pricing.campaignActionCad +
      metrics.conversions * pricing.conversionCad
    );
  }

  private async _finalizeCampaignBilling(
    campaignId: Types.ObjectId,
  ): Promise<void> {
    const pricing = this._toPricingPayload(await this._ensurePricingDoc());
    const metrics = await this._campaignBillingMetrics(campaignId);
    const finalAmount = this._campaignBillingAmount(pricing, metrics);
    await this._adCampaignModel
      .updateOne(
        { _id: campaignId },
        {
          $set: {
            billingFinalizedAt: new Date(),
            billingFinalAmountCad: Number(finalAmount.toFixed(2)),
            billingSnapshot: {
              metrics,
              pricing: {
                campaignCpmCad: pricing.campaignCpmCad,
                campaignCpcCad: pricing.campaignCpcCad,
                campaignActionCad: pricing.campaignActionCad,
                conversionCad: pricing.conversionCad,
                currency: pricing.currency,
              },
            },
          },
        },
      )
      .exec();
  }

  private async _archiveCampaignById(
    campaignId: Types.ObjectId,
    opts?: { forceEndsNow?: boolean; reason?: AdCampaignArchiveReasonEnum },
  ): Promise<void> {
    const now = new Date();
    const update: Record<string, unknown> = {
      isActive: false,
      archivedAt: now,
      archiveReason: opts?.reason ?? AdCampaignArchiveReasonEnum.ENDED,
    };
    if (opts?.forceEndsNow) {
      update.endsAt = now;
    }
    await this._adCampaignModel
      .updateOne(
        {
          _id: campaignId,
          $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
        },
        { $set: update },
      )
      .exec();
    await this._finalizeCampaignBilling(campaignId);
  }

  private async _autoArchiveExpiredCampaigns(): Promise<void> {
    const now = new Date();
    const expired = await this._adCampaignModel
      .find({
        $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
        endsAt: { $lt: now },
      })
      .select('_id')
      .lean()
      .exec();
    for (const row of expired as Array<Record<string, unknown>>) {
      const campaignId = String(row._id ?? '');
      if (!Types.ObjectId.isValid(campaignId)) continue;
      await this._archiveCampaignById(new Types.ObjectId(campaignId), {
        reason: AdCampaignArchiveReasonEnum.EXPIRED,
      });
    }
  }

  private async _adBillingMetrics(adId: Types.ObjectId): Promise<{
    impressions: number;
    clicks: number;
    conversions: number;
  }> {
    const [impressions, clicks, conversions] = await Promise.all([
      this._adEventModel.countDocuments({
        ad: adId,
        eventType: AdEventTypeEnum.IMPRESSION,
      }),
      this._adEventModel.countDocuments({
        ad: adId,
        eventType: AdEventTypeEnum.CLICK,
      }),
      this._adEventModel.countDocuments({
        ad: adId,
        eventType: AdEventTypeEnum.CONVERSION,
      }),
    ]);
    return { impressions, clicks, conversions };
  }

  private _adBillingAmount(
    pricing: AdPricingPayload,
    metrics: { impressions: number; clicks: number; conversions: number },
  ): number {
    return (
      (metrics.impressions / 1000) * pricing.cpmCad +
      metrics.clicks * pricing.cpcCad +
      metrics.conversions * pricing.conversionCad
    );
  }

  private async _finalizeAdBilling(adId: Types.ObjectId): Promise<void> {
    const pricing = this._toPricingPayload(await this._ensurePricingDoc());
    const metrics = await this._adBillingMetrics(adId);
    const finalAmount = this._adBillingAmount(pricing, metrics);
    await this.adModel
      .updateOne(
        { _id: adId },
        {
          $set: {
            billingFinalizedAt: new Date(),
            billingFinalAmountCad: Number(finalAmount.toFixed(2)),
            billingSnapshot: {
              metrics,
              pricing: {
                cpmCad: pricing.cpmCad,
                cpcCad: pricing.cpcCad,
                conversionCad: pricing.conversionCad,
                currency: pricing.currency,
              },
            },
          },
        },
      )
      .exec();
  }

  private async _archiveAdById(
    adId: Types.ObjectId,
    opts?: { forceEndsNow?: boolean; reason?: AdArchiveReasonEnum },
  ): Promise<void> {
    const now = new Date();
    const update: Record<string, unknown> = {
      isActive: false,
      archivedAt: now,
      archiveReason: opts?.reason ?? AdArchiveReasonEnum.ENDED,
    };
    if (opts?.forceEndsNow) {
      update.validUntil = now;
    }
    await this.adModel
      .updateOne(
        {
          _id: adId,
          $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
        },
        { $set: update },
      )
      .exec();
    this.invalidateListCache();
    await this._finalizeAdBilling(adId);
  }

  private async _autoArchiveExpiredAds(): Promise<void> {
    const now = new Date();
    const expired = await this.adModel
      .find({
        $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
        validUntil: { $lt: now },
      })
      .select('_id')
      .lean()
      .exec();
    for (const row of expired as Array<Record<string, unknown>>) {
      const adId = String(row._id ?? '');
      if (!Types.ObjectId.isValid(adId)) continue;
      await this._archiveAdById(new Types.ObjectId(adId), {
        reason: AdArchiveReasonEnum.EXPIRED,
      });
    }
  }

  async listCampaignsForManagement(
    user: UserModel,
  ): Promise<AdCampaignManagementRow[]> {
    this.assertVendorOrAdmin(user);
    await this._autoArchiveExpiredCampaigns();
    const manageableStoreIds = await this.resolveManageableCampaignStoreIds(user);
    const query: Record<string, unknown> = {
      $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
    };
    if (user.type !== UserTypeEnum.ADMIN) {
      if (!manageableStoreIds.length) return [];
      query.store = {
        $in: manageableStoreIds.map((id) => new Types.ObjectId(id)),
      };
    }
    const docs = await this._adCampaignModel
      .find(query)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store')
      .populate('items.drink', 'name imageUrl priceCad store')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return (docs as Record<string, unknown>[]).map((d) => this._toCampaignRow(d));
  }

  async listArchivedCampaignsForManagement(
    user: UserModel,
  ): Promise<AdCampaignManagementRow[]> {
    this.assertVendorOrAdmin(user);
    await this._autoArchiveExpiredCampaigns();
    const manageableStoreIds = await this.resolveManageableCampaignStoreIds(user);
    const query: Record<string, unknown> = {
      archivedAt: { $exists: true, $ne: null },
    };
    if (user.type !== UserTypeEnum.ADMIN) {
      if (!manageableStoreIds.length) return [];
      query.store = {
        $in: manageableStoreIds.map((id) => new Types.ObjectId(id)),
      };
    }
    const docs = await this._adCampaignModel
      .find(query)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store')
      .populate('items.drink', 'name imageUrl priceCad store')
      .sort({ archivedAt: -1, createdAt: -1 })
      .lean()
      .exec();
    return (docs as Record<string, unknown>[]).map((d) => this._toCampaignRow(d));
  }

  async createCampaign(
    user: UserModel,
    dto: CreateAdCampaignDto,
  ): Promise<AdCampaignManagementRow> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    await this.assertVendorHasNoUnpaidAdCredit(user);
    const storeId = dto.storeId.trim();
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException('store_not_found');
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('_id')
      .lean()
      .exec();
    if (!store) {
      throw new BadRequestException('store_not_found');
    }
    await this.assertCanManageCampaignStore(user, storeId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this._assertCampaignDateRange(startsAt, endsAt);
    await this._assertCampaignItemsBelongToStore(storeId, dto.items);
    const actionType = dto.actionType ?? StoreAdActionTypeEnum.SHOP;
    if (actionType === StoreAdActionTypeEnum.PRODUCT) {
      throw new BadRequestException('invalid_campaign_action_type');
    }
    const actionText = String(dto.actionText ?? 'Découvrir').trim() || 'Découvrir';
    const actionTarget = isAdLinkActionType(actionType)
      ? this.assertActionTargetValue(actionType, dto.actionTarget)
      : undefined;
    const items = this._normalizeCampaignItems(dto.items).map((it) => ({
      itemType: it.itemType,
      product:
        it.itemType === AdCampaignItemTypeEnum.PRODUCT && it.productId
          ? new Types.ObjectId(it.productId)
          : undefined,
      drink:
        it.itemType === AdCampaignItemTypeEnum.DRINK && it.drinkId
          ? new Types.ObjectId(it.drinkId)
          : undefined,
    }));
    const created = await this._adCampaignModel.create({
      store: new Types.ObjectId(storeId),
      title: dto.title.trim(),
      subtitle: dto.subtitle?.trim() || '',
      description: dto.description?.trim() || '',
      startsAt,
      endsAt,
      isActive: dto.isActive !== false,
      actionType,
      actionText,
      actionTarget: actionTarget || undefined,
      items,
    });
    const row = await this._adCampaignModel
      .findById(created._id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store')
      .populate('items.drink', 'name imageUrl priceCad store')
      .lean()
      .exec();
    return this._toCampaignRow(row as unknown as Record<string, unknown>);
  }

  async patchCampaign(
    user: UserModel,
    id: string,
    dto: PatchAdCampaignDto,
  ): Promise<AdCampaignManagementRow> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('campaign_not_found');
    }
    const existing = await this._adCampaignModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    if (existing.archivedAt) {
      throw new BadRequestException('campaign_archived_locked');
    }
    const existingStoreId = String(existing.store);
    await this.assertCanManageCampaignStore(user, existingStoreId);
    if (dto.title != null) existing.title = dto.title.trim();
    if (dto.subtitle != null) existing.subtitle = dto.subtitle.trim();
    if (dto.description != null) existing.description = dto.description.trim();
    if (dto.isActive != null) existing.isActive = dto.isActive;
    if (dto.startsAt != null) existing.startsAt = new Date(dto.startsAt);
    if (dto.endsAt != null) existing.endsAt = new Date(dto.endsAt);
    if (dto.actionType != null) {
      if (dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
        throw new BadRequestException('invalid_campaign_action_type');
      }
      existing.actionType = dto.actionType;
    }
    if (dto.actionText != null) {
      const v = dto.actionText.trim();
      existing.actionText = v || 'Découvrir';
    }
    if (dto.actionTarget !== undefined) {
      existing.actionTarget =
        dto.actionTarget == null || dto.actionTarget.trim() === ''
          ? undefined
          : dto.actionTarget.trim();
    }
    const effectiveActionType =
      (existing.actionType as StoreAdActionTypeEnum) ?? StoreAdActionTypeEnum.SHOP;
    if (isAdLinkActionType(effectiveActionType)) {
      existing.actionTarget = this.assertActionTargetValue(
        effectiveActionType,
        existing.actionTarget,
      );
    } else {
      existing.actionTarget = undefined;
    }
    this._assertCampaignDateRange(
      new Date(existing.startsAt as Date),
      new Date(existing.endsAt as Date),
    );
    if (dto.items != null) {
      const sid = existingStoreId;
      await this._assertCampaignItemsBelongToStore(sid, dto.items);
      existing.items = this._normalizeCampaignItems(dto.items).map((it) => ({
        itemType: it.itemType,
        product:
          it.itemType === AdCampaignItemTypeEnum.PRODUCT && it.productId
            ? (new Types.ObjectId(it.productId) as unknown as ProductModel)
            : undefined,
        drink:
          it.itemType === AdCampaignItemTypeEnum.DRINK && it.drinkId
            ? (new Types.ObjectId(it.drinkId) as unknown as DrinkModel)
            : undefined,
      }));
    }
    await existing.save();
    const row = await this._adCampaignModel
      .findById(existing._id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store')
      .populate('items.drink', 'name imageUrl priceCad store')
      .lean()
      .exec();
    return this._toCampaignRow(row as unknown as Record<string, unknown>);
  }

  async endCampaign(
    user: UserModel,
    id: string,
  ): Promise<{ ok: true; campaignId: string; archivedAt: string }> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('campaign_not_found');
    }
    const existing = await this._adCampaignModel
      .findById(id)
      .select('_id store archivedAt')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    await this.assertCanManageCampaignStore(user, String(existing.store));
    if (!existing.archivedAt) {
      await this._archiveCampaignById(
        new Types.ObjectId(String(existing._id)),
        { forceEndsNow: true, reason: AdCampaignArchiveReasonEnum.ENDED },
      );
    }
    const out = await this._adCampaignModel
      .findById(id)
      .select('_id archivedAt')
      .lean()
      .exec();
    return {
      ok: true,
      campaignId: String(out?._id ?? id),
      archivedAt: new Date(
        String((out as { archivedAt?: Date | string } | null)?.archivedAt ?? new Date()),
      ).toISOString(),
    };
  }

  async removeCampaign(user: UserModel, id: string): Promise<void> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    const existing = await this._adCampaignModel
      .findById(id)
      .select('store')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    await this.assertCanManageCampaignStore(user, String(existing.store));
    const res = await this._adCampaignModel.deleteOne({ _id: id }).exec();
    if (!res.deletedCount) {
      throw new NotFoundException('campaign_not_found');
    }
  }

  async listCampaignsPublic(): Promise<{ items: PublicAdCampaignRow[] }> {
    await this._autoArchiveExpiredCampaigns();
    const now = new Date();
    const docs = await this._adCampaignModel
      .find({
        $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
        isActive: true,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
      })
      .populate('store', 'name status profileImage')
      .populate('items.product', 'title profileImage price status')
      .populate('items.drink', 'name imageUrl priceCad')
      .sort({ startsAt: -1, createdAt: -1 })
      .lean()
      .exec();
    const rows = (docs as Record<string, unknown>[])
      .map((d) => this._toCampaignRow(d))
      .filter((row) => row.items.length > 0);
    return {
      items: rows.map((row) => ({
        id: row.id,
        storeId: row.storeId,
        storeName: row.storeName,
        storeProfileImageUrl: row.storeProfileImageUrl ?? null,
        title: row.title,
        subtitle: row.subtitle,
        description: row.description,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        actionType: row.actionType,
        actionText: row.actionText,
        actionTarget: row.actionTarget,
        items: row.items,
      })),
    };
  }

  async trackCampaignEvent(
    user: UserModel | null,
    dto: TrackAdCampaignEventDto,
  ): Promise<{ ok: true }> {
    if (
      dto.eventType !== AdCampaignEventTypeEnum.IMPRESSION &&
      dto.eventType !== AdCampaignEventTypeEnum.CLICK
    ) {
      throw new BadRequestException('invalid_campaign_event_type');
    }
    const campaignId = dto.campaignId.trim();
    if (!Types.ObjectId.isValid(campaignId)) {
      throw new BadRequestException('campaign_not_found');
    }
    const now = new Date();
    const campaign = await this._adCampaignModel
      .findOne({
        _id: new Types.ObjectId(campaignId),
        $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
        isActive: true,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
      })
      .select('_id store')
      .lean()
      .exec();
    if (!campaign) {
      throw new NotFoundException('campaign_not_found');
    }

    const itemType = String(dto.itemType ?? '').trim().toUpperCase();
    if (
      itemType !== AdCampaignItemTypeEnum.PRODUCT &&
      itemType !== AdCampaignItemTypeEnum.DRINK &&
      itemType !== 'STORE_ACTION'
    ) {
      throw new BadRequestException('invalid_campaign_item_type');
    }
    const itemId = String(dto.itemId ?? '').trim();
    if (!itemId || !Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('invalid_campaign_item_id');
    }
    if (itemType === 'STORE_ACTION') {
      const campaignStoreId = String((campaign as { store?: unknown }).store ?? '');
      if (!campaignStoreId || campaignStoreId !== itemId) {
        throw new BadRequestException('campaign_item_not_found');
      }
    } else {
      const existsInCampaign = await this._adCampaignModel
        .exists({
          _id: new Types.ObjectId(campaignId),
          items: {
            $elemMatch:
              itemType === AdCampaignItemTypeEnum.PRODUCT
                ? { itemType, product: new Types.ObjectId(itemId) }
                : { itemType, drink: new Types.ObjectId(itemId) },
          },
        })
        .exec();
      if (!existsInCampaign) {
        throw new BadRequestException('campaign_item_not_found');
      }
    }

    await this._adCampaignEventModel.create({
      campaign: new Types.ObjectId(campaignId),
      user:
        user?._id && Types.ObjectId.isValid(String(user._id))
          ? new Types.ObjectId(String(user._id))
          : undefined,
      eventType: dto.eventType,
      itemType,
      itemId,
      clientInstallId: dto.clientInstallId?.trim() || undefined,
    });

    return { ok: true };
  }

  async trackOrderConversions(args: {
    orderId: string;
    userId: string;
    storeId: string;
    items: Array<{ itemType: string; entityId: string }>;
  }): Promise<{ ok: true; bannerConversions: number; campaignConversions: number }> {
    const orderId = String(args.orderId ?? '').trim();
    const userId = String(args.userId ?? '').trim();
    const storeId = String(args.storeId ?? '').trim();
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(storeId) ||
      orderId.length === 0
    ) {
      return { ok: true, bannerConversions: 0, campaignConversions: 0 };
    }

    const purchased = args.items
      .map((it) => ({
        itemType: String(it.itemType ?? '').trim().toUpperCase(),
        itemId: String(it.entityId ?? '').trim(),
      }))
      .filter(
        (it) =>
          (it.itemType === AdCampaignItemTypeEnum.PRODUCT ||
            it.itemType === AdCampaignItemTypeEnum.DRINK) &&
          Types.ObjectId.isValid(it.itemId),
      );
    if (!purchased.length) {
      return { ok: true, bannerConversions: 0, campaignConversions: 0 };
    }

    const purchasedProducts = new Set(
      purchased
        .filter((it) => it.itemType === AdCampaignItemTypeEnum.PRODUCT)
        .map((it) => it.itemId),
    );
    const purchasedByKey = new Set(
      purchased.map((it) => `${it.itemType}:${it.itemId}`),
    );
    const since = new Date(Date.now() - AD_CONVERSION_ATTRIBUTION_WINDOW_MS);
    const userOid = new Types.ObjectId(userId);
    const storeOid = new Types.ObjectId(storeId);

    // Attribution campagne: dernier clic item (plat/boisson) de la campagne sur la même boutique.
    let campaignConversions = 0;
    const campaignClicks = await this._adCampaignEventModel
      .find({
        user: userOid,
        eventType: AdCampaignEventTypeEnum.CLICK,
        itemType: {
          $in: [AdCampaignItemTypeEnum.PRODUCT, AdCampaignItemTypeEnum.DRINK],
        },
        createdAt: { $gte: since },
      })
      .select('campaign itemType itemId createdAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (campaignClicks.length > 0) {
      const campaignIds = [
        ...new Set(
          campaignClicks
            .map((row) => String(row.campaign ?? ''))
            .filter((id) => Types.ObjectId.isValid(id)),
        ),
      ].map((id) => new Types.ObjectId(id));
      const campaigns = campaignIds.length
        ? await this._adCampaignModel
            .find({ _id: { $in: campaignIds } })
            .select('_id store')
            .lean()
            .exec()
        : [];
      const campaignStoreById = new Map<string, string>();
      for (const row of campaigns as Array<Record<string, unknown>>) {
        const cid = String(row._id ?? '');
        const sid = String(row.store ?? '');
        if (Types.ObjectId.isValid(cid) && Types.ObjectId.isValid(sid)) {
          campaignStoreById.set(cid, sid);
        }
      }
      const existingCampaignConversions = await this._adCampaignEventModel
        .find({
          campaign: { $in: campaignIds },
          eventType: AdCampaignEventTypeEnum.CONVERSION,
          orderId,
        })
        .select('campaign itemType itemId')
        .lean()
        .exec();
      const existingCampaignKeys = new Set(
        existingCampaignConversions.map(
          (row) =>
            `${String(row.campaign ?? '')}:${String(row.itemType ?? '').toUpperCase()}:${String(row.itemId ?? '')}`,
        ),
      );

      const pendingRows: Array<{
        campaign: Types.ObjectId;
        itemType: string;
        itemId: string;
      }> = [];
      const seenOrderItemKeys = new Set<string>();
      for (const click of campaignClicks as Array<Record<string, unknown>>) {
        const campaignId = String(click.campaign ?? '').trim();
        const itemType = String(click.itemType ?? '').trim().toUpperCase();
        const itemId = String(click.itemId ?? '').trim();
        if (!Types.ObjectId.isValid(campaignId) || !Types.ObjectId.isValid(itemId)) {
          continue;
        }
        if (campaignStoreById.get(campaignId) !== storeOid.toHexString()) {
          continue;
        }
        const orderItemKey = `${itemType}:${itemId}`;
        if (!purchasedByKey.has(orderItemKey) || seenOrderItemKeys.has(orderItemKey)) {
          continue;
        }
        const dedupeKey = `${campaignId}:${itemType}:${itemId}`;
        if (existingCampaignKeys.has(dedupeKey)) {
          seenOrderItemKeys.add(orderItemKey);
          continue;
        }
        existingCampaignKeys.add(dedupeKey);
        seenOrderItemKeys.add(orderItemKey);
        pendingRows.push({
          campaign: new Types.ObjectId(campaignId),
          itemType,
          itemId,
        });
      }

      if (pendingRows.length > 0) {
        await this._adCampaignEventModel.insertMany(
          pendingRows.map((row) => ({
            campaign: row.campaign,
            user: userOid,
            eventType: AdCampaignEventTypeEnum.CONVERSION,
            itemType: row.itemType,
            itemId: row.itemId,
            orderId,
            conversionSource: AdCampaignConversionSourceEnum.CAMPAIGN_ITEM,
          })),
          { ordered: false },
        );
        campaignConversions = pendingRows.length;
      }
    }

    // Attribution bannière: dernier clic éligible (produit exact ou boutique).
    let bannerConversions = 0;
    const adClicks = await this._adEventModel
      .find({
        user: userOid,
        eventType: AdEventTypeEnum.CLICK,
        createdAt: { $gte: since },
      })
      .select('ad createdAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (adClicks.length > 0) {
      const adIds = [
        ...new Set(
          adClicks
            .map((row) => String(row.ad ?? ''))
            .filter((id) => Types.ObjectId.isValid(id)),
        ),
      ].map((id) => new Types.ObjectId(id));
      const ads = adIds.length
        ? await this.adModel
            .find({ _id: { $in: adIds } })
            .select('_id store product')
            .lean()
            .exec()
        : [];
      const adById = new Map<string, Record<string, unknown>>();
      for (const ad of ads as Array<Record<string, unknown>>) {
        adById.set(String(ad._id ?? ''), ad);
      }
      for (const click of adClicks as Array<Record<string, unknown>>) {
        const adId = String(click.ad ?? '').trim();
        if (!Types.ObjectId.isValid(adId)) continue;
        const ad = adById.get(adId);
        if (!ad) continue;
        const adProductId = String(ad.product ?? '').trim();
        const adStoreId = String(ad.store ?? '').trim();
        const eligible =
          (Types.ObjectId.isValid(adProductId) && purchasedProducts.has(adProductId)) ||
          (Types.ObjectId.isValid(adStoreId) && adStoreId === storeOid.toHexString()) ||
          (!Types.ObjectId.isValid(adProductId) && !Types.ObjectId.isValid(adStoreId));
        if (!eligible) continue;
        const conversionSource = Types.ObjectId.isValid(adProductId) &&
          purchasedProducts.has(adProductId)
          ? AdConversionSourceEnum.BANNER_PRODUCT
          : Types.ObjectId.isValid(adStoreId) && adStoreId === storeOid.toHexString()
          ? AdConversionSourceEnum.BANNER_STORE
          : AdConversionSourceEnum.BANNER_GENERIC;
        const exists = await this._adEventModel
          .exists({
            ad: new Types.ObjectId(adId),
            user: userOid,
            eventType: AdEventTypeEnum.CONVERSION,
            orderId,
          })
          .exec();
        if (exists) break;
        await this._adEventModel.create({
          ad: new Types.ObjectId(adId),
          user: userOid,
          eventType: AdEventTypeEnum.CONVERSION,
          orderId,
          conversionSource,
        });
        bannerConversions = 1;
        break;
      }
    }

    return { ok: true, bannerConversions, campaignConversions };
  }

  async getMyAdCredit(user: UserModel): Promise<AdCreditSummaryPayload> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    await this._autoArchiveExpiredCampaigns();
    await this._autoArchiveExpiredAds();
    const pricing = this._toPricingPayload(await this._ensurePricingDoc());
    const access = await this._storeAccess.resolveStoreAccess(user);
    const storeMeta = access
      .filter((a) => Types.ObjectId.isValid(a.storeId))
      .map((a) => ({ storeId: a.storeId, storeName: a.storeName || a.storeId }));
    const storeIds = storeMeta.map((a) => new Types.ObjectId(a.storeId));

    if (!storeIds.length) {
      const ownerId = new Types.ObjectId(String(user._id));
      let paidTotal = await this._adCreditPaidTotalCad(ownerId);
      if (paidTotal <= 0) {
        await this._backfillRecentAdCreditPayments(ownerId);
        paidTotal = await this._adCreditPaidTotalCad(ownerId);
      }
      return {
        currency: pricing.currency,
        grossDue: 0,
        paidTotal: Number(paidTotal.toFixed(2)),
        creditBalance: Number(paidTotal.toFixed(2)),
        banners: { impressions: 0, clicks: 0, conversions: 0, due: 0 },
        campaigns: {
          impressions: 0,
          clicks: 0,
          actionClicks: 0,
          conversions: 0,
          due: 0,
        },
        stores: [],
        totalDue: 0,
      };
    }

    const perStore = new Map<
      string,
      {
        storeName: string;
        banners: { impressions: number; clicks: number; conversions: number; due: number };
        campaigns: {
          impressions: number;
          clicks: number;
          actionClicks: number;
          conversions: number;
          due: number;
        };
      }
    >();
    for (const s of storeMeta) {
      perStore.set(s.storeId, {
        storeName: s.storeName,
        banners: { impressions: 0, clicks: 0, conversions: 0, due: 0 },
        campaigns: { impressions: 0, clicks: 0, actionClicks: 0, conversions: 0, due: 0 },
      });
    }

    const bannerDocs = await this.adModel
      .find({
        store: { $in: storeIds },
      })
      .select('_id store archivedAt billingFinalAmountCad')
      .lean()
      .exec();
    const adStoreById = new Map<string, string>();
    for (const doc of bannerDocs as Array<Record<string, unknown>>) {
      const adId = String(doc._id ?? '');
      const sid = String(doc.store ?? '');
      if (Types.ObjectId.isValid(adId) && Types.ObjectId.isValid(sid)) {
        adStoreById.set(adId, sid);
      }
    }
    const adObjectIds = bannerDocs
      .map((x) => String(x._id))
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const [bannerImpressions, bannerClicks, bannerConversions, bannerAgg] = adObjectIds.length
      ? await Promise.all([
          this._adEventModel.countDocuments({
            ad: { $in: adObjectIds },
            eventType: AdEventTypeEnum.IMPRESSION,
          }),
          this._adEventModel.countDocuments({
            ad: { $in: adObjectIds },
            eventType: AdEventTypeEnum.CLICK,
          }),
          this._adEventModel.countDocuments({
            ad: { $in: adObjectIds },
            eventType: AdEventTypeEnum.CONVERSION,
          }),
          this._adEventModel
            .aggregate<
              { _id: { ad: Types.ObjectId; eventType: AdEventTypeEnum }; count: number }
            >([
              {
                $match: {
                  ad: { $in: adObjectIds },
                  eventType: {
                    $in: [
                      AdEventTypeEnum.IMPRESSION,
                      AdEventTypeEnum.CLICK,
                      AdEventTypeEnum.CONVERSION,
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: { ad: '$ad', eventType: '$eventType' },
                  count: { $sum: 1 },
                },
              },
            ])
            .exec(),
        ])
      : [0, 0, 0, []];
    for (const row of bannerAgg) {
      const adId = String(row._id.ad ?? '');
      const storeId = adStoreById.get(adId);
      if (!storeId) continue;
      const current = perStore.get(storeId);
      if (!current) continue;
      if (row._id.eventType === AdEventTypeEnum.IMPRESSION) {
        current.banners.impressions += row.count;
      } else if (row._id.eventType === AdEventTypeEnum.CLICK) {
        current.banners.clicks += row.count;
      } else if (row._id.eventType === AdEventTypeEnum.CONVERSION) {
        current.banners.conversions += row.count;
      }
    }
    const bannerMetricsById = new Map<
      string,
      { impressions: number; clicks: number; conversions: number }
    >();
    for (const row of bannerAgg) {
      const adId = String(row._id.ad ?? '');
      if (!adId || !Types.ObjectId.isValid(adId)) continue;
      const current = bannerMetricsById.get(adId) ?? {
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      if (row._id.eventType === AdEventTypeEnum.IMPRESSION) {
        current.impressions += row.count;
      } else if (row._id.eventType === AdEventTypeEnum.CLICK) {
        current.clicks += row.count;
      } else if (row._id.eventType === AdEventTypeEnum.CONVERSION) {
        current.conversions += row.count;
      }
      bannerMetricsById.set(adId, current);
    }
    const bannerDueByStore = new Map<string, number>();
    for (const doc of bannerDocs as Array<Record<string, unknown>>) {
      const adId = String(doc._id ?? '');
      const storeId = String(doc.store ?? '');
      if (!Types.ObjectId.isValid(adId) || !Types.ObjectId.isValid(storeId)) {
        continue;
      }
      const metrics = bannerMetricsById.get(adId) ?? {
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      const archivedAt = doc.archivedAt;
      const isArchived = archivedAt != null && String(archivedAt).trim() !== '';
      const due = isArchived
        ? Number(doc.billingFinalAmountCad ?? this._adBillingAmount(pricing, metrics))
        : 0;
      bannerDueByStore.set(storeId, (bannerDueByStore.get(storeId) ?? 0) + due);
    }

    const campaignDocs = await this._adCampaignModel
      .find({
        store: { $in: storeIds },
      })
      .select('_id store archivedAt billingFinalAmountCad')
      .lean()
      .exec();
    const campaignStoreById = new Map<string, string>();
    for (const doc of campaignDocs as Array<Record<string, unknown>>) {
      const cid = String(doc._id ?? '');
      const sid = String(doc.store ?? '');
      if (Types.ObjectId.isValid(cid) && Types.ObjectId.isValid(sid)) {
        campaignStoreById.set(cid, sid);
      }
    }
    const campaignObjectIds = campaignDocs
      .map((x) => String(x._id))
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const [
      campaignImpressions,
      campaignClicks,
      campaignActionClicks,
      campaignConversions,
      campaignAgg,
    ] =
      campaignObjectIds.length
      ? await Promise.all([
          this._adCampaignEventModel.countDocuments({
            campaign: { $in: campaignObjectIds },
            eventType: AdCampaignEventTypeEnum.IMPRESSION,
          }),
          this._adCampaignEventModel.countDocuments({
            campaign: { $in: campaignObjectIds },
            eventType: AdCampaignEventTypeEnum.CLICK,
            itemType: { $in: [AdCampaignItemTypeEnum.PRODUCT, AdCampaignItemTypeEnum.DRINK] },
          }),
          this._adCampaignEventModel.countDocuments({
            campaign: { $in: campaignObjectIds },
            eventType: AdCampaignEventTypeEnum.CLICK,
            itemType: 'STORE_ACTION',
          }),
          this._adCampaignEventModel.countDocuments({
            campaign: { $in: campaignObjectIds },
            eventType: AdCampaignEventTypeEnum.CONVERSION,
          }),
          this._adCampaignEventModel
            .aggregate<
              {
                _id: {
                  campaign: Types.ObjectId;
                  eventType: AdCampaignEventTypeEnum;
                  itemType: string;
                };
                count: number;
              }
            >([
              {
                $match: {
                  campaign: { $in: campaignObjectIds },
                  eventType: {
                    $in: [
                      AdCampaignEventTypeEnum.IMPRESSION,
                      AdCampaignEventTypeEnum.CLICK,
                      AdCampaignEventTypeEnum.CONVERSION,
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: {
                    campaign: '$campaign',
                    eventType: '$eventType',
                    itemType: '$itemType',
                  },
                  count: { $sum: 1 },
                },
              },
            ])
            .exec(),
        ])
      : [0, 0, 0, 0, []];
    for (const row of campaignAgg) {
      const campaignId = String(row._id.campaign ?? '');
      const storeId = campaignStoreById.get(campaignId);
      if (!storeId) continue;
      const current = perStore.get(storeId);
      if (!current) continue;
      if (row._id.eventType === AdCampaignEventTypeEnum.IMPRESSION) {
        current.campaigns.impressions += row.count;
        continue;
      }
      if (row._id.eventType === AdCampaignEventTypeEnum.CONVERSION) {
        current.campaigns.conversions += row.count;
      } else if (row._id.itemType === 'STORE_ACTION') {
        current.campaigns.actionClicks += row.count;
      } else {
        current.campaigns.clicks += row.count;
      }
    }

    const bannersDue = [...bannerDueByStore.values()].reduce((acc, v) => acc + v, 0);
    const campaignMetricsById = new Map<
      string,
      { impressions: number; clicks: number; actionClicks: number; conversions: number }
    >();
    for (const row of campaignAgg) {
      const campaignId = String(row._id.campaign ?? '');
      if (!campaignId || !Types.ObjectId.isValid(campaignId)) continue;
      const current = campaignMetricsById.get(campaignId) ?? {
        impressions: 0,
        clicks: 0,
        actionClicks: 0,
        conversions: 0,
      };
      if (row._id.eventType === AdCampaignEventTypeEnum.IMPRESSION) {
        current.impressions += row.count;
      } else if (row._id.eventType === AdCampaignEventTypeEnum.CONVERSION) {
        current.conversions += row.count;
      } else if (row._id.itemType === 'STORE_ACTION') {
        current.actionClicks += row.count;
      } else {
        current.clicks += row.count;
      }
      campaignMetricsById.set(campaignId, current);
    }
    const campaignDueByStore = new Map<string, number>();
    for (const doc of campaignDocs as Array<Record<string, unknown>>) {
      const campaignId = String(doc._id ?? '');
      const storeId = String(doc.store ?? '');
      if (!Types.ObjectId.isValid(campaignId) || !Types.ObjectId.isValid(storeId)) {
        continue;
      }
      const metrics = campaignMetricsById.get(campaignId) ?? {
        impressions: 0,
        clicks: 0,
        actionClicks: 0,
        conversions: 0,
      };
      const archivedAt = doc.archivedAt;
      const isArchived = archivedAt != null && String(archivedAt).trim() !== '';
      const due = isArchived
        ? Number(
            doc.billingFinalAmountCad ??
              this._campaignBillingAmount(pricing, metrics),
          )
        : 0;
      campaignDueByStore.set(storeId, (campaignDueByStore.get(storeId) ?? 0) + due);
    }
    const campaignsDue = [...campaignDueByStore.values()].reduce(
      (acc, v) => acc + v,
      0,
    );
    const grossDue = Number((bannersDue + campaignsDue).toFixed(2));

    const stores = [...perStore.entries()].map(([storeId, row]) => {
      const bannerDue =
        bannerDueByStore.get(storeId) ??
        ((row.banners.impressions / 1000) * pricing.cpmCad +
          row.banners.clicks * pricing.cpcCad +
          row.banners.conversions * pricing.conversionCad);
      const campaignDue =
        campaignDueByStore.get(storeId) ??
        ((row.campaigns.impressions / 1000) * pricing.campaignCpmCad +
          row.campaigns.clicks * pricing.campaignCpcCad +
          row.campaigns.actionClicks * pricing.campaignActionCad +
          row.campaigns.conversions * pricing.conversionCad);
      return {
        storeId,
        storeName: row.storeName,
        banners: {
          impressions: row.banners.impressions,
          clicks: row.banners.clicks,
          conversions: row.banners.conversions,
          due: Number(bannerDue.toFixed(2)),
        },
        campaigns: {
          impressions: row.campaigns.impressions,
          clicks: row.campaigns.clicks,
          actionClicks: row.campaigns.actionClicks,
          conversions: row.campaigns.conversions,
          due: Number(campaignDue.toFixed(2)),
        },
        totalDue: Number((bannerDue + campaignDue).toFixed(2)),
      };
    });

    const ownerId = new Types.ObjectId(String(user._id));
    let paidTotal = await this._adCreditPaidTotalCad(ownerId);
    if (paidTotal <= 0) {
      await this._backfillRecentAdCreditPayments(ownerId);
      paidTotal = await this._adCreditPaidTotalCad(ownerId);
    }
    const applied = this.applyPaidAmountToStoreBreakdown(stores, paidTotal);
    return {
      currency: pricing.currency,
      grossDue,
      paidTotal: Number(paidTotal.toFixed(2)),
      creditBalance: applied.creditBalance,
      banners: {
        impressions: bannerImpressions,
        clicks: bannerClicks,
        conversions: bannerConversions,
        due: applied.bannersDue,
      },
      campaigns: {
        impressions: campaignImpressions,
        clicks: campaignClicks,
        actionClicks: campaignActionClicks,
        conversions: campaignConversions,
        due: applied.campaignsDue,
      },
      stores: applied.stores,
      totalDue: applied.outstandingDue,
    };
  }

  async createAdCreditCheckoutSession(
    user: UserModel,
  ): Promise<{ url: string; sessionId: string; amountCad: number }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const credit = await this.getMyAdCredit(user);
    const outstanding = Number(credit.totalDue ?? 0);
    if (outstanding <= 0) {
      throw new BadRequestException('ad_credit_already_settled');
    }
    const amountCad = Number(
      Math.max(outstanding, AD_CREDIT_STRIPE_MIN_CAD).toFixed(2),
    );
    const unitAmount = Math.round(amountCad * 100);
    if (unitAmount < 50) {
      throw new BadRequestException('amount_below_stripe_minimum');
    }

    const ownerId = String(user._id);
    const stripe = this.stripe();
    const meta: Record<string, string> = {
      kind: AD_CREDIT_CHECKOUT_METADATA_KIND,
      uid: ownerId,
      outstandingDueCad: Number(outstanding).toFixed(2),
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: 'cad',
      client_reference_id: ownerId,
      customer_email: user.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'cad',
            unit_amount: unitAmount,
            product_data: {
              name: 'Afrika Meals · Règlement crédit Ads',
              description: `Règlement du crédit Ads vendeur (solde: ${outstanding.toFixed(
                2,
              )} CAD)`,
            },
          },
        },
      ],
      success_url: this.adCreditSuccessUrl(),
      cancel_url: this.adCreditCancelUrl(),
      metadata: meta,
      payment_intent_data: {
        description: 'Afrika Meals · Paiement crédit Ads',
        metadata: meta,
      },
    });
    if (!session.url) {
      throw new BadRequestException('stripe_missing_checkout_url');
    }
    return { url: session.url, sessionId: session.id, amountCad };
  }

  async getAdCreditCheckoutHealth(
    user: UserModel,
  ): Promise<{ available: boolean; reason?: string }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    try {
      this.stripe();
    } catch (e) {
      if (e instanceof BadRequestException) {
        return { available: false, reason: 'stripe_not_configured' };
      }
      throw e;
    }
    return { available: true };
  }

  async confirmAdCreditCheckout(
    user: UserModel,
    sessionId: string,
  ): Promise<{ ok: true; amountPaidCad: number; sessionId: string }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const sid = String(sessionId ?? '').trim();
    if (!sid) {
      throw new BadRequestException('missing_session_id');
    }
    const stripe = this.stripe();
    const session = await stripe.checkout.sessions.retrieve(sid, {
      expand: ['payment_intent'],
    });
    if (
      session.metadata?.kind !== AD_CREDIT_CHECKOUT_METADATA_KIND ||
      String(session.metadata?.uid ?? '') !== String(user._id)
    ) {
      throw new ForbiddenException('ad_credit_checkout_user_mismatch');
    }
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      throw new BadRequestException('ad_credit_checkout_not_paid');
    }
    const amountPaidCad = Number(((session.amount_total ?? 0) / 100).toFixed(2));
    if (!Number.isFinite(amountPaidCad) || amountPaidCad <= 0) {
      throw new BadRequestException('ad_credit_checkout_invalid_amount');
    }
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    await this._adCreditPaymentModel
      .updateOne(
        { stripeCheckoutSessionId: sid },
        {
          $setOnInsert: {
            owner: new Types.ObjectId(String(user._id)),
            amountPaidCad,
            currency: 'CAD',
            status: AdCreditPaymentStatusEnum.PAID,
            stripeCheckoutSessionId: sid,
            stripePaymentIntentId: paymentIntentId,
            paidAt: new Date(),
          },
        },
        { upsert: true },
      )
      .exec();
    return { ok: true, amountPaidCad, sessionId: sid };
  }

  async uploadBannerImage(
    user: UserModel,
    file?: Express.Multer.File,
  ): Promise<{ url: string }> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    if (!file?.buffer?.length) {
      throw new BadRequestException('empty_image');
    }
    const url = await this._mediasService.upload(file, user, 'marketing/ads');
    return { url };
  }

  /** Même destination Storage que multipart ; corps JSON pour proxys qui coupent multipart. */
  async uploadBannerImageJson(
    user: UserModel,
    dto: AdBannerImageJsonDto,
  ): Promise<{ url: string }> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    const raw = dto.imageBase64
      .replace(/\s/g, '')
      .replace(/^data:image\/[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_image');
    }
    const max = 5 * 1024 * 1024;
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (dto.filename || 'banner.jpg').trim() || 'banner.jpg';
    if (!/\.(jpe?g|png|webp)$/i.test(name)) {
      throw new BadRequestException('invalid_file_type');
    }
    const lower = name.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';
    const file = {
      fieldname: 'file',
      originalname: name,
      encoding: '7bit',
      mimetype: mime,
      buffer,
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: undefined,
    } as Express.Multer.File;
    const url = await this._mediasService.upload(file, user, 'marketing/ads');
    return { url };
  }

  private async assertUserCanManageStore(
    user: UserModel,
    storeId: string,
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN) return;
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
    const sid = new Types.ObjectId(storeId);
    const n = await this._storeModel
      .countDocuments({ _id: sid, owner: user._id })
      .exec();
    if (!n) {
      throw new ForbiddenException('store_not_owned');
    }
  }

  private async vendorStoreIds(user: UserModel): Promise<Types.ObjectId[]> {
    const docs = await this._storeModel
      .find({ owner: user._id })
      .select('_id')
      .lean()
      .exec();
    return docs.map((d) => d._id as Types.ObjectId);
  }

  /** Valide et normalise la cible pour les actions « lien / contact ». */
  private assertActionTargetValue(
    actionType: StoreAdActionTypeEnum,
    raw: string | undefined | null,
  ): string {
    if (!isAdLinkActionType(actionType)) {
      return '';
    }
    const t = (raw ?? '').trim();
    if (!t) {
      throw new BadRequestException('action_target_required');
    }
    if (actionType === StoreAdActionTypeEnum.EMAIL) {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
      if (!ok) {
        throw new BadRequestException('invalid_action_target_email');
      }
      return t;
    }
    if (actionType === StoreAdActionTypeEnum.WEBSITE) {
      try {
        const u = new URL(/^[a-z]+:/i.test(t) ? t : `https://${t}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          throw new BadRequestException('invalid_action_target_url');
        }
        return u.toString();
      } catch {
        throw new BadRequestException('invalid_action_target_url');
      }
    }
    const digits = t.replace(/\D/g, '');
    if (digits.length < 6) {
      throw new BadRequestException('invalid_action_target_phone');
    }
    return t;
  }

  private assertDateRange(validFrom: Date, validUntil: Date) {
    if (!(validFrom instanceof Date) || Number.isNaN(validFrom.getTime())) {
      throw new BadRequestException('invalid_valid_from');
    }
    if (!(validUntil instanceof Date) || Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('invalid_valid_until');
    }
    if (validUntil.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('valid_until_must_be_after_valid_from');
    }
  }

  private toManagementRow(doc: Record<string, unknown>): AdManagementRow {
    const id = String(doc._id ?? doc.id ?? '');
    const st = doc.store as
      | { _id?: Types.ObjectId; name?: string }
      | Types.ObjectId
      | string
      | undefined
      | null;
    let storeId: string | null = null;
    let storeName: string | null = null;
    if (st && typeof st === 'object' && '_id' in st) {
      storeId = (st._id as Types.ObjectId).toString();
      storeName = String((st as { name?: string }).name ?? '') || null;
    } else if (st instanceof Types.ObjectId) {
      storeId = st.toString();
    } else if (typeof st === 'string' && st) {
      storeId = st;
    }
    const pr = doc.product as
      | { _id?: Types.ObjectId; title?: string }
      | Types.ObjectId
      | string
      | undefined
      | null;
    let productId: string | null = null;
    let productTitle: string | null = null;
    if (pr && typeof pr === 'object' && '_id' in pr) {
      productId = (pr._id as Types.ObjectId).toString();
      productTitle = String((pr as { title?: string }).title ?? '') || null;
    } else if (pr instanceof Types.ObjectId) {
      productId = pr.toString();
    } else if (typeof pr === 'string' && pr) {
      productId = pr;
    }
    const vf = doc.validFrom as Date | string | undefined | null;
    const vu = doc.validUntil as Date | string | undefined | null;
    const at =
      (doc.actionType as StoreAdActionTypeEnum) ?? StoreAdActionTypeEnum.SHOP;
    const validFromIso =
      vf == null ? null : vf instanceof Date ? vf.toISOString() : String(vf);
    const validUntilIso =
      vu == null ? null : vu instanceof Date ? vu.toISOString() : String(vu);
    const actTarget =
      doc.actionTarget != null && String(doc.actionTarget).trim() !== ''
        ? String(doc.actionTarget).trim()
        : null;
    return {
      id,
      storeId,
      storeName,
      title: String(doc.title ?? ''),
      subtitle: String(doc.subtitle ?? ''),
      actionText: String(doc.actionText ?? ''),
      imageUrl: doc.imageUrl != null ? String(doc.imageUrl) : null,
      sortOrder: Number(doc.sortOrder ?? 0),
      isActive: Boolean(doc.isActive),
      validFrom: validFromIso,
      validUntil: validUntilIso,
      actionType: at,
      actionTarget: actTarget,
      productId,
      productTitle,
      archivedAt:
        doc.archivedAt instanceof Date
          ? doc.archivedAt.toISOString()
          : doc.archivedAt != null
          ? String(doc.archivedAt)
          : null,
      archiveReason:
        doc.archiveReason != null && String(doc.archiveReason).trim() !== ''
          ? (String(doc.archiveReason).trim().toUpperCase() as AdArchiveReasonEnum)
          : null,
      billingFinalizedAt:
        doc.billingFinalizedAt instanceof Date
          ? doc.billingFinalizedAt.toISOString()
          : doc.billingFinalizedAt != null
          ? String(doc.billingFinalizedAt)
          : null,
      billingFinalAmountCad: Number(doc.billingFinalAmountCad ?? 0),
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : doc.createdAt != null
          ? String(doc.createdAt)
          : undefined,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : doc.updatedAt != null
          ? String(doc.updatedAt)
          : undefined,
    };
  }

  private passesDateWindow(
    validFrom: Date | undefined,
    validUntil: Date | undefined,
    now: Date,
  ): boolean {
    if (!validFrom && !validUntil) return true;
    if (validFrom && now.getTime() < new Date(validFrom).getTime()) {
      return false;
    }
    if (validUntil && now.getTime() > new Date(validUntil).getTime()) {
      return false;
    }
    return true;
  }

  /**
   * Complète `store` quand `.populate` laisse un ObjectId (ref, version driver, etc.) :
   * sans ça, le filtre public excluait toutes les pubs boutique.
   */
  private async hydrateStoresForPublicAds(
    docs: Record<string, unknown>[],
  ): Promise<void> {
    const needHydration: { index: number; id: Types.ObjectId }[] = [];

    for (let i = 0; i < docs.length; i++) {
      const st = docs[i]['store'];
      if (st == null) continue;
      if (st instanceof Types.ObjectId) {
        needHydration.push({ index: i, id: st });
        continue;
      }
      if (typeof st === 'object' && !Array.isArray(st)) {
        const o = st as Record<string, unknown>;
        const hasPopulatedFields =
          typeof o['status'] === 'string' || typeof o['name'] === 'string';
        if (!hasPopulatedFields) {
          const idRaw = o['_id'] ?? o['id'];
          try {
            const id =
              idRaw instanceof Types.ObjectId
                ? idRaw
                : new Types.ObjectId(String(idRaw));
            needHydration.push({ index: i, id });
          } catch {
            // id invalide
          }
        }
      }
    }

    if (!needHydration.length) return;

    const uniqueIds = [
      ...new Map(needHydration.map((x) => [x.id.toString(), x.id])).values(),
    ];

    const stores = await this._storeModel
      .aggregate([
        ...pipelineActiveStoresWithStripeOnboarded(uniqueIds),
        { $project: { name: 1, profileImage: 1, status: 1 } },
      ])
      .exec();

    const byId = new Map(
      stores.map((s) => {
        const sid = String((s as { _id?: unknown })._id ?? '');
        return [sid, s] as const;
      }),
    );

    for (const { index, id } of needHydration) {
      const full = byId.get(id.toString());
      if (full != null) {
        docs[index]['store'] = full as unknown;
      }
    }
  }

  /**
   * Pub « liée boutique » : `store` peuplé (pas une simple ref orpheline) — distincte des bannières globales admin.
   */
  private isShopRelatedPublicAd(d: AdModel): boolean {
    const st = d.store as
      | { status?: string }
      | Types.ObjectId
      | null
      | undefined;
    if (st == null) return false;
    if (st instanceof Types.ObjectId) return false;
    return typeof st === 'object';
  }

  /**
   * Réordonne les pubs pour qu’au moins **2/3** des entrées soient des pubs liées boutique,
   * lorsque la base contient assez de telles pubs. Sinon : toutes les pubs boutique en tête, puis les globales.
   * (Même ensemble d’éléments, ordre seulement.)
   */
  private orderPublicAdsByMinTwoThirdsShop(orderedAll: AdModel[]): AdModel[] {
    const shopAds: AdModel[] = [];
    const globalAds: AdModel[] = [];
    for (const d of orderedAll) {
      if (this.isShopRelatedPublicAd(d)) {
        shopAds.push(d);
      } else {
        globalAds.push(d);
      }
    }
    const n = shopAds.length + globalAds.length;
    if (n === 0) {
      return [];
    }
    const minShopSlots = Math.ceil((2 * n) / 3);
    if (shopAds.length < minShopSlots) {
      return [...shopAds, ...globalAds];
    }
    const remainingShops = [...shopAds];
    const remainingGlobals = [...globalAds];
    const out: AdModel[] = [];
    while (out.length < n) {
      for (
        let k = 0;
        k < 2 && remainingShops.length > 0 && out.length < n;
        k++
      ) {
        out.push(remainingShops.shift()!);
      }
      if (out.length >= n) break;
      if (remainingGlobals.length > 0) {
        out.push(remainingGlobals.shift()!);
      } else {
        while (remainingShops.length > 0 && out.length < n) {
          out.push(remainingShops.shift()!);
        }
      }
    }
    while (remainingGlobals.length > 0 && out.length < n) {
      out.push(remainingGlobals.shift()!);
    }
    while (remainingShops.length > 0 && out.length < n) {
      out.push(remainingShops.shift()!);
    }
    return out;
  }

  private _storeIdFromAdDoc(d: Record<string, unknown>): Types.ObjectId | null {
    const st = d.store;
    if (st == null) return null;
    if (st instanceof Types.ObjectId) return st;
    if (typeof st === 'object' && !Array.isArray(st)) {
      const o = st as Record<string, unknown>;
      const raw = o['_id'] ?? o['id'];
      if (raw instanceof Types.ObjectId) return raw;
      const s = raw != null ? String(raw).trim() : '';
      if (Types.ObjectId.isValid(s)) return new Types.ObjectId(s);
    }
    return null;
  }

  /**
   * Bannières pour l’accueil public : globales (sans boutique) +
   * publicités boutiques actives (boutique ACTIVE, dates valides).
   * Ordre renvoyé : au moins 2/3 de pubs **liées boutique** (`store` défini) quand le stock le permet.
   */
  async listPublic(): Promise<AdModel[]> {
    await this._autoArchiveExpiredAds();
    const now = Date.now();
    // Ne pas servir un cache calculé avant le filtre Stripe Connect (paiements vendeur).
    if (
      this._listCache &&
      this._listCache.stripeFiltered === true &&
      now - this._listCache.at < AdsService._LIST_TTL_MS
    ) {
      return this._listCache.data;
    }
    const raw = await this.adModel
      .find({ isActive: true })
      .populate('store', 'name profileImage status')
      .populate('product', 'title')
      .sort({ sortOrder: 1 })
      .lean()
      .exec();
    const docs = raw as unknown as Record<string, unknown>[];
    await this.hydrateStoresForPublicAds(docs);
    const shopStoreIds = [
      ...new Set(
        docs
          .map((d) => this._storeIdFromAdDoc(d))
          .filter((id): id is Types.ObjectId => id != null)
          .map((id) => id.toString()),
      ),
    ].map((s) => new Types.ObjectId(s));
    const paymentsReadyStoreIds = await resolveStoreIdsVisibleOnMobileApp(
      this._storeModel,
      shopStoreIds,
    );
    const t = new Date();
    const data = docs.filter((d) => {
      if (d.archivedAt != null && String(d.archivedAt).trim() !== '') {
        return false;
      }
      if (
        !this.passesDateWindow(
          d.validFrom as Date | undefined,
          d.validUntil as Date | undefined,
          t,
        )
      ) {
        return false;
      }
      const storeOid = this._storeIdFromAdDoc(d);
      if (storeOid == null) return true;
      return paymentsReadyStoreIds.has(storeOid.toString());
    }) as unknown as AdModel[];
    const ordered = this.orderPublicAdsByMinTwoThirdsShop(data);
    this._listCache = { at: now, data: ordered, stripeFiltered: true };
    return ordered;
  }

  /** @deprecated Utiliser `listPublic` (même comportement). */
  async list(): Promise<AdModel[]> {
    return this.listPublic();
  }

  async listForManagement(user: UserModel): Promise<AdManagementRow[]> {
    this.assertVendorOrAdmin(user);
    await this._autoArchiveExpiredAds();
    if (user.type === UserTypeEnum.ADMIN) {
      const docs = await this.adModel
        .find()
        .populate('store', 'name')
        .populate('product', 'title')
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean()
        .exec();
      return docs.map((d) =>
        this.toManagementRow(d as Record<string, unknown>),
      );
    }
    const ids = await this.vendorStoreIds(user);
    if (!ids.length) {
      return [];
    }
    const docs = await this.adModel
      .find({ store: { $in: ids } })
      .populate('store', 'name')
      .populate('product', 'title')
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => this.toManagementRow(d as Record<string, unknown>));
  }

  private async assertProductBelongsToStore(
    productId: string,
    storeId: string,
  ): Promise<void> {
    const n = await this._productModel
      .countDocuments({
        _id: new Types.ObjectId(productId),
        store: new Types.ObjectId(storeId),
      })
      .exec();
    if (!n) {
      throw new BadRequestException('product_not_in_store');
    }
  }

  async createManagement(
    user: UserModel,
    dto: CreateAdManagementDto,
  ): Promise<AdManagementRow> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    await this.assertVendorHasNoUnpaidAdCredit(user);
    const storeIdRaw = dto.storeId?.trim();
    const storeOid =
      storeIdRaw && Types.ObjectId.isValid(storeIdRaw)
        ? new Types.ObjectId(storeIdRaw)
        : undefined;

    if (user.type === UserTypeEnum.VENDOR) {
      if (!storeOid) {
        throw new ForbiddenException('global_ad_vendor_forbidden');
      }
      await this.assertUserCanManageStore(user, storeOid.toString());
    }

    if (!storeOid && dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
      throw new BadRequestException('global_product_action_forbidden');
    }

    if (storeOid) {
      await this.assertUserCanManageStore(user, storeOid.toString());
    }

    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    this.assertDateRange(validFrom, validUntil);

    if (dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
      if (!dto.productId || !storeOid) {
        throw new BadRequestException('product_required_for_action');
      }
      await this.assertProductBelongsToStore(
        dto.productId,
        storeOid.toString(),
      );
    }

    const linkTarget = isAdLinkActionType(dto.actionType)
      ? this.assertActionTargetValue(dto.actionType, dto.actionTarget)
      : undefined;

    const created = await this.adModel.create({
      isActive: dto.isActive !== false,
      title: dto.title.trim(),
      subtitle: dto.subtitle.trim(),
      actionText: dto.actionText.trim(),
      imageUrl: dto.imageUrl?.trim() || undefined,
      sortOrder: dto.sortOrder ?? 0,
      store: storeOid,
      validFrom,
      validUntil,
      actionType: dto.actionType,
      actionTarget: linkTarget || undefined,
      product:
        dto.actionType === StoreAdActionTypeEnum.PRODUCT && dto.productId
          ? productRefId(dto.productId)
          : undefined,
    });

    this.invalidateListCache();

    const populated = await this.adModel
      .findById(created._id)
      .populate('store', 'name')
      .populate('product', 'title')
      .lean()
      .exec();
    return this.toManagementRow(populated as Record<string, unknown>);
  }

  async patchManagement(
    user: UserModel,
    id: string,
    dto: PatchAdManagementDto,
  ): Promise<AdManagementRow> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    const oid = new Types.ObjectId(id);
    const existing = await this.adModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    if (existing.archivedAt) {
      throw new BadRequestException('ad_archived_locked');
    }

    const storeRef = existing.store;
    const storeIdStr = storeRef != null ? String(storeRef) : null;
    if (storeIdStr) {
      await this.assertUserCanManageStore(user, storeIdStr);
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }

    const nextAction =
      dto.actionType ?? existing.actionType ?? StoreAdActionTypeEnum.SHOP;
    if (!storeIdStr && nextAction === StoreAdActionTypeEnum.PRODUCT) {
      throw new BadRequestException('global_product_action_forbidden');
    }

    if (dto.validFrom != null || dto.validUntil != null) {
      const nf =
        dto.validFrom != null
          ? new Date(dto.validFrom)
          : existing.validFrom
          ? new Date(existing.validFrom as Date)
          : null;
      const nu =
        dto.validUntil != null
          ? new Date(dto.validUntil)
          : existing.validUntil
          ? new Date(existing.validUntil as Date)
          : null;
      if (!nf || !nu) {
        throw new BadRequestException('ad_dates_incomplete');
      }
      this.assertDateRange(nf, nu);
      if (dto.validFrom != null) existing.validFrom = nf;
      if (dto.validUntil != null) existing.validUntil = nu;
    }

    if (dto.title != null) existing.title = dto.title.trim();
    if (dto.subtitle != null) existing.subtitle = dto.subtitle.trim();
    if (dto.actionText != null) existing.actionText = dto.actionText.trim();
    if (dto.imageUrl !== undefined) {
      existing.imageUrl =
        dto.imageUrl === null || dto.imageUrl === ''
          ? undefined
          : dto.imageUrl.trim();
    }
    if (dto.sortOrder != null) existing.sortOrder = dto.sortOrder;
    if (dto.isActive != null) existing.isActive = dto.isActive;
    if (dto.actionType != null) existing.actionType = dto.actionType;

    const effectiveStoreId = storeIdStr;
    if (dto.actionType === StoreAdActionTypeEnum.SHOP) {
      existing.product = undefined;
      existing.actionTarget = undefined;
    } else if (dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
      existing.actionTarget = undefined;
      const pid = dto.productId;
      if (!pid || !effectiveStoreId) {
        throw new BadRequestException('product_required_for_action');
      }
      await this.assertProductBelongsToStore(pid, effectiveStoreId);
      existing.product = productRefId(pid);
    } else if (dto.actionType != null && isAdLinkActionType(dto.actionType)) {
      existing.product = undefined;
      if (dto.actionTarget !== undefined) {
        existing.actionTarget =
          dto.actionTarget === null || dto.actionTarget === ''
            ? undefined
            : this.assertActionTargetValue(dto.actionType, dto.actionTarget);
      }
    }

    if (dto.productId === null) {
      existing.product = undefined;
    } else if (
      dto.productId &&
      !dto.actionType &&
      existing.actionType === StoreAdActionTypeEnum.PRODUCT &&
      effectiveStoreId
    ) {
      await this.assertProductBelongsToStore(dto.productId, effectiveStoreId);
      existing.product = productRefId(dto.productId);
    }

    if (
      dto.actionTarget !== undefined &&
      dto.actionType == null &&
      isAdLinkActionType(existing.actionType as StoreAdActionTypeEnum)
    ) {
      existing.actionTarget =
        dto.actionTarget === null || dto.actionTarget === ''
          ? undefined
          : this.assertActionTargetValue(
              existing.actionType as StoreAdActionTypeEnum,
              dto.actionTarget,
            );
    }

    const finalType =
      (existing.actionType as StoreAdActionTypeEnum) ??
      StoreAdActionTypeEnum.SHOP;
    if (isAdLinkActionType(finalType)) {
      existing.actionTarget = this.assertActionTargetValue(
        finalType,
        existing.actionTarget,
      );
    } else {
      existing.actionTarget = undefined;
    }

    await existing.save();
    this.invalidateListCache();

    const populated = await this.adModel
      .findById(oid)
      .populate('store', 'name')
      .populate('product', 'title')
      .lean()
      .exec();
    return this.toManagementRow(populated as Record<string, unknown>);
  }

  async endManagement(
    user: UserModel,
    id: string,
  ): Promise<{ ok: true; adId: string; archivedAt: string }> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ad_not_found');
    }
    const existing = await this.adModel
      .findById(id)
      .select('_id store archivedAt')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    const storeIdStr = existing.store != null ? String(existing.store) : null;
    if (storeIdStr) {
      await this.assertUserCanManageStore(user, storeIdStr);
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }
    if (!existing.archivedAt) {
      await this._archiveAdById(new Types.ObjectId(String(existing._id)), {
        forceEndsNow: true,
        reason: AdArchiveReasonEnum.ENDED,
      });
      this.invalidateListCache();
    }
    const out = await this.adModel
      .findById(id)
      .select('_id archivedAt')
      .lean()
      .exec();
    return {
      ok: true,
      adId: String(out?._id ?? id),
      archivedAt: new Date(
        String((out as { archivedAt?: Date | string } | null)?.archivedAt ?? new Date()),
      ).toISOString(),
    };
  }

  async removeManagement(user: UserModel, id: string): Promise<void> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    const oid = new Types.ObjectId(id);
    const existing = await this.adModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    const storeRef = existing.store;
    const storeIdStr = storeRef != null ? String(storeRef) : null;
    if (storeIdStr) {
      await this.assertUserCanManageStore(user, storeIdStr);
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }

    const res = await this.adModel.deleteOne({ _id: oid }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('ad_not_found');
    }
    this.invalidateListCache();
  }

  private async assertAdTrackableForClient(adId: string): Promise<void> {
    const oid = new Types.ObjectId(adId);
    const doc = await this.adModel.findById(oid).lean().exec();
    if (
      !doc ||
      !doc.isActive ||
      (doc.archivedAt != null && String(doc.archivedAt).trim() !== '')
    ) {
      throw new NotFoundException('ad_not_found');
    }
    const t = new Date();
    if (
      !this.passesDateWindow(
        doc.validFrom as Date | undefined,
        doc.validUntil as Date | undefined,
        t,
      )
    ) {
      throw new BadRequestException('ad_not_trackable');
    }
  }

  async trackEvent(
    user: UserModel | undefined | null,
    dto: TrackAdEventDto,
  ): Promise<{ ok: true }> {
    if (
      dto.eventType !== AdEventTypeEnum.IMPRESSION &&
      dto.eventType !== AdEventTypeEnum.CLICK
    ) {
      throw new BadRequestException('invalid_ad_event_type');
    }
    await this.assertAdTrackableForClient(dto.adId);
    const oid = new Types.ObjectId(dto.adId);
    const uid =
      user && (user as UserModel)._id
        ? ((user as UserModel)._id as Types.ObjectId)
        : undefined;
    const install = dto.clientInstallId?.trim().slice(0, 128);
    await this._adEventModel.create({
      ad: oid,
      user: uid,
      eventType: dto.eventType,
      ...(install ? { clientInstallId: install } : {}),
    });
    return { ok: true };
  }

  private async assertUserCanManageAdById(
    user: UserModel,
    adId: string,
  ): Promise<void> {
    const oid = new Types.ObjectId(adId);
    const existing = await this.adModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    const storeRef = existing.store;
    const storeIdStr = storeRef != null ? String(storeRef) : null;
    if (storeIdStr) {
      await this.assertUserCanManageStore(user, storeIdStr);
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }
  }

  private async assertUserCanManageCampaignById(
    user: UserModel,
    campaignId: string,
  ): Promise<void> {
    const existing = await this._adCampaignModel
      .findById(campaignId)
      .select('store')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    await this.assertCanManageCampaignStore(user, String(existing.store));
  }

  async getAdStats(user: UserModel, adId: string): Promise<AdStatsPayload> {
    this.assertVendorOrAdmin(user);
    await this.assertUserCanManageAdById(user, adId);
    const oid = new Types.ObjectId(adId);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 6);
    since.setUTCHours(0, 0, 0, 0);

    const [
      impressionsTotal,
      clicksTotal,
      conversionsTotal,
      impUsers,
      clkUsers,
      convUsers,
      deviceIds,
      byDay,
      recentDocs,
    ] = await Promise.all([
      this._adEventModel
        .countDocuments({ ad: oid, eventType: AdEventTypeEnum.IMPRESSION })
        .exec(),
      this._adEventModel
        .countDocuments({ ad: oid, eventType: AdEventTypeEnum.CLICK })
        .exec(),
      this._adEventModel
        .countDocuments({ ad: oid, eventType: AdEventTypeEnum.CONVERSION })
        .exec(),
      this._adEventModel.distinct('user', {
        ad: oid,
        eventType: AdEventTypeEnum.IMPRESSION,
        user: { $exists: true, $ne: null },
      }),
      this._adEventModel.distinct('user', {
        ad: oid,
        eventType: AdEventTypeEnum.CLICK,
        user: { $exists: true, $ne: null },
      }),
      this._adEventModel.distinct('user', {
        ad: oid,
        eventType: AdEventTypeEnum.CONVERSION,
        user: { $exists: true, $ne: null },
      }),
      this._adEventModel.distinct('clientInstallId', {
        ad: oid,
        clientInstallId: { $exists: true, $nin: [null, ''] },
      }),
      this._adEventModel
        .aggregate<{
          _id: string;
          impressions: number;
          clicks: number;
          conversions: number;
        }>([
          {
            $match: {
              ad: oid,
              createdAt: { $gte: since },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt',
                  timezone: 'UTC',
                },
              },
              impressions: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AdEventTypeEnum.IMPRESSION] },
                    1,
                    0,
                  ],
                },
              },
              clicks: {
                $sum: {
                  $cond: [{ $eq: ['$eventType', AdEventTypeEnum.CLICK] }, 1, 0],
                },
              },
              conversions: {
                $sum: {
                  $cond: [{ $eq: ['$eventType', AdEventTypeEnum.CONVERSION] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .exec(),
      this._adEventModel
        .find({ ad: oid })
        .sort({ createdAt: -1 })
        .limit(80)
        .populate('user', 'email fullName')
        .lean()
        .exec(),
    ]);

    const recentEvents: AdStatsRecentEvent[] = recentDocs.map((row) => {
      const r = row as Record<string, unknown>;
      const u = r.user as
        | { _id?: Types.ObjectId; email?: string; fullName?: string }
        | Types.ObjectId
        | null
        | undefined;
      let userId: string | null = null;
      let userEmail: string | null = null;
      let userFullName: string | null = null;
      if (u && typeof u === 'object' && '_id' in u) {
        const pop = u as {
          _id?: Types.ObjectId;
          email?: string;
          fullName?: string;
        };
        userId = pop._id ? pop._id.toString() : null;
        userEmail = pop.email != null ? String(pop.email) : null;
        userFullName = pop.fullName != null ? String(pop.fullName) : null;
      }
      const ca = r.createdAt as Date | string | undefined;
      return {
        eventType: r.eventType as AdEventTypeEnum,
        conversionSource:
          r.conversionSource != null ? (String(r.conversionSource) as AdConversionSourceEnum) : null,
        createdAt:
          ca instanceof Date ? ca.toISOString() : String(ca ?? new Date()),
        userId,
        userEmail,
        userFullName,
        clientInstallId:
          r.clientInstallId != null ? String(r.clientInstallId) : null,
      };
    });

    const last7Days: AdStatsDayBucket[] = byDay.map((d) => ({
      date: d._id,
      impressions: d.impressions,
      clicks: d.clicks,
      conversions: d.conversions,
    }));

    return {
      adId,
      impressionsTotal,
      clicksTotal,
      conversionsTotal,
      uniqueUsersImpressions: impUsers.filter(Boolean).length,
      uniqueUsersClicks: clkUsers.filter(Boolean).length,
      uniqueUsersConversions: convUsers.filter(Boolean).length,
      uniqueClientDevices: deviceIds.filter(Boolean).length,
      last7Days,
      recentEvents,
    };
  }

  async getCampaignStats(
    user: UserModel,
    campaignId: string,
  ): Promise<AdCampaignStatsPayload> {
    this.assertVendorOrAdmin(user);
    if (!Types.ObjectId.isValid(campaignId)) {
      throw new NotFoundException('campaign_not_found');
    }
    await this.assertUserCanManageCampaignById(user, campaignId);
    const oid = new Types.ObjectId(campaignId);

    const campaign = await this._adCampaignModel
      .findById(oid)
      .populate('store', 'name')
      .populate('items.product', 'title')
      .populate('items.drink', 'name')
      .select('store items')
      .lean()
      .exec();
    if (!campaign) {
      throw new NotFoundException('campaign_not_found');
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 6);
    since.setUTCHours(0, 0, 0, 0);

    const [
      impressionsTotal,
      clicksTotal,
      actionClicksTotal,
      conversionsTotal,
      impUsers,
      clkUsers,
      convUsers,
      deviceIds,
      byDay,
      byItem,
      recentDocs,
    ] = await Promise.all([
      this._adCampaignEventModel
        .countDocuments({
          campaign: oid,
          eventType: AdCampaignEventTypeEnum.IMPRESSION,
        })
        .exec(),
      this._adCampaignEventModel
        .countDocuments({
          campaign: oid,
          eventType: AdCampaignEventTypeEnum.CLICK,
        })
        .exec(),
      this._adCampaignEventModel
        .countDocuments({
          campaign: oid,
          eventType: AdCampaignEventTypeEnum.CLICK,
          itemType: 'STORE_ACTION',
        })
        .exec(),
      this._adCampaignEventModel
        .countDocuments({
          campaign: oid,
          eventType: AdCampaignEventTypeEnum.CONVERSION,
        })
        .exec(),
      this._adCampaignEventModel.distinct('user', {
        campaign: oid,
        eventType: AdCampaignEventTypeEnum.IMPRESSION,
        user: { $exists: true, $ne: null },
      }),
      this._adCampaignEventModel.distinct('user', {
        campaign: oid,
        eventType: AdCampaignEventTypeEnum.CLICK,
        user: { $exists: true, $ne: null },
      }),
      this._adCampaignEventModel.distinct('user', {
        campaign: oid,
        eventType: AdCampaignEventTypeEnum.CONVERSION,
        user: { $exists: true, $ne: null },
      }),
      this._adCampaignEventModel.distinct('clientInstallId', {
        campaign: oid,
        clientInstallId: { $exists: true, $nin: [null, ''] },
      }),
      this._adCampaignEventModel
        .aggregate<{
          _id: string;
          impressions: number;
          clicks: number;
          actionClicks: number;
          conversions: number;
        }>([
          {
            $match: {
              campaign: oid,
              createdAt: { $gte: since },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt',
                  timezone: 'UTC',
                },
              },
              impressions: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AdCampaignEventTypeEnum.IMPRESSION] },
                    1,
                    0,
                  ],
                },
              },
              clicks: {
                $sum: {
                  $cond: [{ $eq: ['$eventType', AdCampaignEventTypeEnum.CLICK] }, 1, 0],
                },
              },
              actionClicks: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$eventType', AdCampaignEventTypeEnum.CLICK] },
                        { $eq: ['$itemType', 'STORE_ACTION'] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              conversions: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AdCampaignEventTypeEnum.CONVERSION] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .exec(),
      this._adCampaignEventModel
        .aggregate<{
          _id: { itemType: string; itemId: string };
          impressions: number;
          clicks: number;
          conversions: number;
        }>([
          {
            $match: {
              campaign: oid,
              eventType: {
                $in: [
                  AdCampaignEventTypeEnum.IMPRESSION,
                  AdCampaignEventTypeEnum.CLICK,
                  AdCampaignEventTypeEnum.CONVERSION,
                ],
              },
            },
          },
          {
            $group: {
              _id: {
                itemType: '$itemType',
                itemId: '$itemId',
              },
              impressions: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AdCampaignEventTypeEnum.IMPRESSION] },
                    1,
                    0,
                  ],
                },
              },
              clicks: {
                $sum: {
                  $cond: [{ $eq: ['$eventType', AdCampaignEventTypeEnum.CLICK] }, 1, 0],
                },
              },
              conversions: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AdCampaignEventTypeEnum.CONVERSION] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { conversions: -1, clicks: -1, impressions: -1 } },
        ])
        .exec(),
      this._adCampaignEventModel
        .find({ campaign: oid })
        .sort({ createdAt: -1 })
        .limit(80)
        .populate('user', 'email fullName')
        .lean()
        .exec(),
    ]);

    const itemTitles = new Map<string, string>();
    const store = campaign.store as Record<string, unknown> | undefined | null;
    const storeId = store?._id ? String(store._id) : '';
    const storeName = String(store?.name ?? '').trim() || 'Boutique';
    if (storeId) {
      itemTitles.set(`STORE_ACTION:${storeId}`, `Action finale (${storeName})`);
    }
    const campaignItems = Array.isArray(campaign.items)
      ? (campaign.items as Record<string, unknown>[])
      : [];
    for (const item of campaignItems) {
      const itemType = String(item.itemType ?? '').trim().toUpperCase();
      if (itemType === AdCampaignItemTypeEnum.PRODUCT) {
        const p = item.product as Record<string, unknown> | undefined | null;
        const itemId = p?._id ? String(p._id) : '';
        if (!itemId) continue;
        const title = String(p?.title ?? '').trim() || '(produit supprimé)';
        itemTitles.set(`PRODUCT:${itemId}`, title);
      } else if (itemType === AdCampaignItemTypeEnum.DRINK) {
        const d = item.drink as Record<string, unknown> | undefined | null;
        const itemId = d?._id ? String(d._id) : '';
        if (!itemId) continue;
        const title = String(d?.name ?? '').trim() || '(boisson supprimée)';
        itemTitles.set(`DRINK:${itemId}`, title);
      }
    }

    const performanceMap = new Map<
      string,
      {
        itemType: string;
        itemId: string;
        title: string;
        impressions: number;
        clicks: number;
        conversions: number;
      }
    >();
    for (const [key, title] of itemTitles.entries()) {
      const [itemType, itemId] = key.split(':');
      if (!itemType || !itemId) continue;
      performanceMap.set(key, {
        itemType,
        itemId,
        title,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      });
    }
    for (const row of byItem) {
      const itemType = String(row._id.itemType ?? '').trim().toUpperCase();
      const itemId = String(row._id.itemId ?? '').trim();
      if (!itemType || !itemId) continue;
      const key = `${itemType}:${itemId}`;
      const current = performanceMap.get(key) ?? {
        itemType,
        itemId,
        title: itemTitles.get(key) ?? itemId,
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      current.impressions = Number(row.impressions ?? 0);
      current.clicks = Number(row.clicks ?? 0);
      current.conversions = Number(row.conversions ?? 0);
      performanceMap.set(key, current);
    }
    const itemPerformance: AdCampaignItemPerformance[] = [
      ...performanceMap.values(),
    ]
      .map((row) => ({
        itemType: row.itemType,
        itemId: row.itemId,
        title: row.title,
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: row.conversions,
        ctrPercent:
          row.impressions > 0
            ? Number(((row.clicks / row.impressions) * 100).toFixed(2))
            : 0,
        conversionRatePercent:
          row.clicks > 0
            ? Number(((row.conversions / row.clicks) * 100).toFixed(2))
            : 0,
      }))
      .sort(
        (a, b) =>
          b.conversions - a.conversions ||
          b.clicks - a.clicks ||
          b.impressions - a.impressions ||
          a.title.localeCompare(b.title),
      );

    const recentEvents: AdCampaignStatsRecentEvent[] = recentDocs.map((row) => {
      const r = row as Record<string, unknown>;
      const u = r.user as
        | { _id?: Types.ObjectId; email?: string; fullName?: string }
        | Types.ObjectId
        | null
        | undefined;
      let userId: string | null = null;
      let userEmail: string | null = null;
      let userFullName: string | null = null;
      if (u && typeof u === 'object' && '_id' in u) {
        const pop = u as {
          _id?: Types.ObjectId;
          email?: string;
          fullName?: string;
        };
        userId = pop._id ? pop._id.toString() : null;
        userEmail = pop.email != null ? String(pop.email) : null;
        userFullName = pop.fullName != null ? String(pop.fullName) : null;
      }
      const ca = r.createdAt as Date | string | undefined;
      return {
        eventType: r.eventType as AdCampaignEventTypeEnum,
        conversionSource:
          r.conversionSource != null
            ? (String(r.conversionSource) as AdCampaignConversionSourceEnum)
            : null,
        itemType: String(r.itemType ?? ''),
        itemId: String(r.itemId ?? ''),
        createdAt:
          ca instanceof Date ? ca.toISOString() : String(ca ?? new Date()),
        userId,
        userEmail,
        userFullName,
        clientInstallId:
          r.clientInstallId != null ? String(r.clientInstallId) : null,
      };
    });

    const last7Days: AdCampaignStatsDayBucket[] = byDay.map((d) => ({
      date: d._id,
      impressions: d.impressions,
      clicks: d.clicks,
      actionClicks: d.actionClicks,
      conversions: d.conversions,
    }));

    return {
      campaignId,
      impressionsTotal,
      clicksTotal,
      actionClicksTotal,
      conversionsTotal,
      uniqueUsersImpressions: impUsers.filter(Boolean).length,
      uniqueUsersClicks: clkUsers.filter(Boolean).length,
      uniqueUsersConversions: convUsers.filter(Boolean).length,
      uniqueClientDevices: deviceIds.filter(Boolean).length,
      last7Days,
      itemPerformance,
      recentEvents,
    };
  }

  async seedIfEmpty() {
    const count = await this.adModel.countDocuments().exec();
    if (count > 0) return;
    await this.adModel.insertMany([
      {
        isActive: true,
        title: 'Special Offer',
        subtitle: 'Discount 20% off applied at checkout',
        actionText: 'Order Now',
        imageUrl: null,
        sortOrder: 0,
        actionType: StoreAdActionTypeEnum.SHOP,
      },
      {
        isActive: true,
        title: 'Free Delivery',
        subtitle: 'On orders over $25 this week',
        actionText: 'Shop Now',
        imageUrl: null,
        sortOrder: 1,
        actionType: StoreAdActionTypeEnum.SHOP,
      },
      {
        isActive: true,
        title: 'New Arrivals',
        subtitle: 'Discover our latest dishes',
        actionText: 'Explore',
        imageUrl: null,
        sortOrder: 2,
        actionType: StoreAdActionTypeEnum.SHOP,
      },
    ]);
  }
}
