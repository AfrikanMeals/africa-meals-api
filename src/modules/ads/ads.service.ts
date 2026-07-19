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
import { UpdateAdNotificationPricingDto } from '@modules/ads/dto/ad-notification.dto';
import { UpdateAdPricingDto } from '@modules/ads/dto/ad-pricing.dto';
import { parseAvailableChannelsFromDoc } from '@modules/ads/ad-notification-channel-availability.util';
import {
  audienceTotalFromDoc,
  normalizeAudienceTotal,
  normalizeNotificationAddonInput,
  notificationAddonFromDoc,
  NotificationAddonPayload,
} from '@modules/ads/ad-notification.util';
import { AdNotificationService } from '@modules/ads/ad-notification.service';
import type { AdNotificationStatsPayload } from '@modules/ads/ad-notification-stats.types';
import { TrackAdEventDto } from '@modules/ads/dto/ad-tracking.dto';
import { TrackAdCampaignEventDto } from '@modules/ads/dto/ad-campaign-tracking.dto';
import {
  pipelineActiveStoresWithStripeOnboarded,
  isStripeConnectOnboardingCompleteUser,
  resolveStoreIdsVisibleOnMobileApp,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { detectCatalogImageStorageKind } from '@common/media/detect-storage-engine.util';
import { MediasService } from '@modules/medias/medias.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { storePermissionGranted } from '../../common/permissions/store-permissions';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { SubscriptionPlanOrderCommissionService } from '@modules/subscriptions/subscription-plan-order-commission.service';
import { SearchSettingsService } from '@modules/search-settings/search-settings.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { RegionPricingService } from '@modules/supported-countries/region-pricing.service';
import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import {
  AD_REGION_ALL,
  adRegionMatchesClient,
  isAdRegionAll,
  normalizeAdRegionScope,
} from '@modules/ads/ad-region-scope.util';
import {
  AdMarketingEntityStatus,
  VendorStatusEmailService,
} from '@modules/vendor-emails/vendor-status-email.service';
import { AdCashEmailService } from '@modules/vendor-emails/ad-cash-email.service';
import { WsAdManagerNotifyService } from '@modules/ws-notify/ws-ad-manager-notify.service';
import { DomainEventPublisherService } from '../../common/domain-events/domain-event-publisher.service';
import { DomainEventDraft } from '../../common/domain-events/domain-event.types';
import { DomainEventType } from '../../common/domain-events/domain-event-types';
import { shouldEmitLegacyAdWsFromApi, isDomainEventsEnabled } from '@modules/domain-event-handlers/domain-event-handlers.util';
import {
  AppCacheKeys,
  apiPublicCacheTtlMs,
} from '@common/redis-app-cache';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
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
  AdNotificationPricingSettingsDocument,
  AdNotificationPricingSettingsModel,
} from '@schemas/ad-notification-pricing-settings.schema';
import {
  AdPricingSettingsDocument,
  AdPricingSettingsModel,
} from '@schemas/ad-pricing-settings.schema';
import {
  AdCreditPaymentModel,
  AdCreditPaymentStatusEnum,
} from '@schemas/ad-credit-payment.schema';
import {
  StoreAdCashLedgerModel,
  StoreAdCashLedgerTypeEnum,
} from '@schemas/store-ad-cash.schema';
import {
  AdArchiveReasonEnum,
  AdModerationStatusEnum,
  AdModel,
  StoreAdActionTypeEnum,
} from '@schemas/ad.schema';
import { DrinkModel } from '@schemas/drink.schema';
import {
  MarketingOfferListingModel,
  MarketingOfferListingStatusEnum,
} from '@schemas/marketing-offer-listing.schema';
import {
  MarketingOfferModel,
  MarketingOfferModerationStatusEnum,
} from '@schemas/marketing-offer.schema';
import { isDirectCheckoutStrategyType } from '@modules/marketing-offer-listings/marketing-offer-strategy-pricing.util';
import {
  campaignBundleItemKey,
  isCampaignBundleItem,
} from '@modules/ads/ad-campaign-bundle-item.util';
import { ProductBundleModel } from '@schemas/product-bundle.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

function productRefId(id: string): NonNullable<AdModel['product']> {
  return new Types.ObjectId(id) as unknown as NonNullable<AdModel['product']>;
}

function exclusiveOfferListingRefId(
  id: string,
): NonNullable<AdModel['marketingOfferListing']> {
  return new Types.ObjectId(id) as unknown as NonNullable<
    AdModel['marketingOfferListing']
  >;
}

function productBundleRefId(
  id: string,
): NonNullable<AdModel['productBundle']> {
  return new Types.ObjectId(id) as unknown as NonNullable<
    AdModel['productBundle']
  >;
}

export type AdManagementRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  /** Région ISO2 de diffusion (globale ou boutique). */
  region: string | null;
  title: string;
  subtitle: string;
  actionText: string;
  imageUrl: string | null;
  imageStorageEngine?: ReturnType<typeof detectCatalogImageStorageKind>;
  sortOrder: number;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
  actionType: StoreAdActionTypeEnum;
  /** Numéro, e-mail ou URL selon `actionType`. */
  actionTarget: string | null;
  productId: string | null;
  productTitle: string | null;
  marketingOfferListingId: string | null;
  marketingOfferListingLabel: string | null;
  /** Présent si actionType = BUNDLE. */
  productBundleId: string | null;
  productBundleLabel: string | null;
  archivedAt: string | null;
  archiveReason: AdArchiveReasonEnum | null;
  billingFinalizedAt: string | null;
  billingFinalAmountCad: number;
  audienceTotal: number | null;
  notificationAddon: NotificationAddonPayload;
  moderationStatus: AdModerationStatusEnum;
  rejectionReason: string | null;
  reviewedAt: string | null;
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
  notifications: AdNotificationStatsPayload;
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
  notifications: AdNotificationStatsPayload;
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
  audienceTotal: number | null;
  notificationAddon: NotificationAddonPayload;
  moderationStatus: AdModerationStatusEnum;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdCampaignItemRow = {
  itemType: AdCampaignItemTypeEnum;
  productId: string | null;
  drinkId: string | null;
  marketingOfferListingId: string | null;
  /** Présent si itemType = BUNDLE. */
  productBundleId: string | null;
  title: string;
  imageUrl: string | null;
  priceCad: number;
  strategyName?: string | null;
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

export type AdModerationQueueItem =
  | ({ kind: 'BANNER' } & AdManagementRow)
  | ({ kind: 'CAMPAIGN' } & AdCampaignManagementRow);

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
    totalDue: number;
    /** Dette brute avant Ad Cash / Stripe. */
    grossDue?: number;
    adCash?: {
      balanceUnits: number;
      exchangeRate: number;
      balanceCurrencyEquivalent: number;
      payableCurrency: number;
    };
  }>;
  totalDue: number;
  adCash?: {
    totalBalanceCurrency: number;
    payableCurrency: number;
  };
};

export type StoreAdCashSummaryPayload = {
  storeId: string;
  storeName: string;
  regionCode: string;
  currency: string;
  exchangeRate: number;
  balanceAdCash: number;
  balanceCurrencyEquivalent: number;
  redeemedCurrency: number;
  recentGrants: Array<{
    id: string;
    adCashAmount: number;
    currencyEquivalent: number;
    note: string | null;
    grantedBy: string | null;
    createdAt: string;
  }>;
};

export type AdminStoreAdSpendingRow = {
  storeId: string;
  storeName: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string | null;
  currency: string;
  bannersPendingCad: number;
  campaignsPendingCad: number;
  adCreditDebtCad: number;
  adCash: {
    balanceUnits: number;
    totalReceivedUnits: number;
    usedUnits: number;
    balanceCurrencyEquivalent: number;
    totalReceivedCurrencyEquivalent: number;
    usedCurrencyEquivalent: number;
  };
};

export type AdminStoreAdSpendingPayload = {
  currency: string;
  items: AdminStoreAdSpendingRow[];
  totals: {
    bannersPendingCad: number;
    campaignsPendingCad: number;
    adCreditDebtCad: number;
    adCashBalanceUnits: number;
    adCashTotalReceivedUnits: number;
    adCashUsedUnits: number;
    adCashBalanceCurrencyEquivalent: number;
    adCashTotalReceivedCurrencyEquivalent: number;
    adCashUsedCurrencyEquivalent: number;
  };
};

export type AdCreditPaymentHistoryRow = {
  id: string;
  amountPaidCad: number;
  currency: string;
  status: AdCreditPaymentStatusEnum;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  paidAt: string;
  createdAt: string | null;
  updatedAt: string | null;
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

export type AdNotificationChannelAvailabilityPayload = {
  email: boolean;
  push: boolean;
  inApp: boolean;
  sms: boolean;
  whatsapp: boolean;
};

export type AdNotificationPricingPayload = {
  currency: string;
  availableChannels: AdNotificationChannelAvailabilityPayload;
  kind?: 'banner' | 'campaign';
  banner?: {
    emailDeliveryCad: number;
    emailInteractionCad: number;
    emailConversionCad: number;
    pushDeliveryCad: number;
    pushInteractionCad: number;
    pushConversionCad: number;
    inAppDeliveryCad: number;
    inAppInteractionCad: number;
    inAppConversionCad: number;
    smsDeliveryCad: number;
    smsInteractionCad: number;
    smsConversionCad: number;
    whatsappDeliveryCad: number;
    whatsappInteractionCad: number;
    whatsappConversionCad: number;
  };
  campaign?: {
    emailDeliveryCad: number;
    emailInteractionCad: number;
    emailConversionCad: number;
    pushDeliveryCad: number;
    pushInteractionCad: number;
    pushConversionCad: number;
    inAppDeliveryCad: number;
    inAppInteractionCad: number;
    inAppConversionCad: number;
    smsDeliveryCad: number;
    smsInteractionCad: number;
    smsConversionCad: number;
    whatsappDeliveryCad: number;
    whatsappInteractionCad: number;
    whatsappConversionCad: number;
  };
  emailDeliveryCad: number;
  emailInteractionCad: number;
  emailConversionCad: number;
  pushDeliveryCad: number;
  pushInteractionCad: number;
  pushConversionCad: number;
  inAppDeliveryCad: number;
  inAppInteractionCad: number;
  inAppConversionCad: number;
  smsDeliveryCad: number;
  smsInteractionCad: number;
  smsConversionCad: number;
  whatsappDeliveryCad: number;
  whatsappInteractionCad: number;
  whatsappConversionCad: number;
  updatedAt: string | null;
};

const ADS_PRICING_KEY = 'default';
const AD_NOTIFICATION_PRICING_KEY = 'default';
const AD_CONVERSION_ATTRIBUTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const AD_CREDIT_CHECKOUT_METADATA_KIND = 'ad_credit_payment';
const AD_CREDIT_STRIPE_MIN_CAD = 0.5;
const AD_CAMPAIGN_MAX_ITEMS = 8;
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

const AD_NOTIFICATION_PRICING_DEFAULTS: Omit<
  AdNotificationPricingPayload,
  'updatedAt'
> = {
  currency: 'CAD',
  availableChannels: {
    email: true,
    push: true,
    inApp: true,
    sms: true,
    whatsapp: true,
  },
  emailDeliveryCad: 0,
  emailInteractionCad: 0,
  emailConversionCad: 0,
  pushDeliveryCad: 0,
  pushInteractionCad: 0,
  pushConversionCad: 0,
  inAppDeliveryCad: 0,
  inAppInteractionCad: 0,
  inAppConversionCad: 0,
  smsDeliveryCad: 0,
  smsInteractionCad: 0,
  smsConversionCad: 0,
  whatsappDeliveryCad: 0,
  whatsappInteractionCad: 0,
  whatsappConversionCad: 0,
};

@Injectable()
export class AdsService implements OnModuleInit {
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

  @InjectModel(AdNotificationPricingSettingsModel.name)
  private readonly _adNotificationPricingModel: Model<AdNotificationPricingSettingsDocument>;

  @InjectModel(AdCreditPaymentModel.name)
  private readonly _adCreditPaymentModel: Model<AdCreditPaymentModel>;

  @InjectModel(StoreAdCashLedgerModel.name)
  private readonly _storeAdCashModel: Model<StoreAdCashLedgerModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(DrinkModel.name)
  private readonly _drinkModel: Model<DrinkModel>;

  @InjectModel(ProductBundleModel.name)
  private readonly _productBundleModel: Model<ProductBundleModel>;

  @InjectModel(MarketingOfferListingModel.name)
  private readonly _marketingOfferListingModel: Model<MarketingOfferListingModel>;

  @InjectModel(MarketingOfferModel.name)
  private readonly _marketingOfferModel: Model<MarketingOfferModel>;

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(SubscriptionsService)
  private readonly _subscriptions: SubscriptionsService;

  @Inject(SubscriptionPlanOrderCommissionService)
  private readonly _planOrderCommission: SubscriptionPlanOrderCommissionService;

  @Inject(SearchSettingsService)
  private readonly _searchSettings: SearchSettingsService;

  @Inject(ConfigService)
  private readonly _config: ConfigService;

  @Inject(AdNotificationService)
  private readonly _adNotifications: AdNotificationService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(RegionPricingService)
  private readonly _regionPricing: RegionPricingService;

  @Inject(VendorStatusEmailService)
  private readonly _vendorStatusEmail: VendorStatusEmailService;

  @Inject(AdCashEmailService)
  private readonly _adCashEmail: AdCashEmailService;

  @Inject(WsAdManagerNotifyService)
  private readonly _wsAdManager: WsAdManagerNotifyService;

  @Optional()
  private readonly _domainPublisher?: DomainEventPublisherService;

  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  async onModuleInit() {
    await this.seedIfEmpty();
  }

  private invalidateListCache() {
    void this._cacheLayer.bustPrefixOnAllStores('ads:public:v3-region:');
  }

  async resolvePublicClientRegion(
    user?: Pick<UserModel, 'type' | 'appCountryCode'> | null,
    countryCode?: string | null,
    clientPlatform?: string,
  ): Promise<string | undefined> {
    return this._supportedCountries.resolveOptionalClientCatalogRegion(
      user,
      countryCode,
      clientPlatform,
    );
  }

  /** Résolution région boutique (region + adresse) pour le filtrage public. */
  async resolveStoreRegionMap(storeIds: string[]): Promise<Map<string, string>> {
    return this._storeRegionsById(storeIds);
  }

  matchesPublicClientRegion(
    clientRegion: string | undefined,
    entityRegion?: string | null,
  ): boolean {
    return this._matchesClientRegion(clientRegion, entityRegion);
  }

  private async publishAdDomainEvent<T extends DomainEventType>(
    draft: DomainEventDraft<T>,
  ): Promise<boolean> {
    if (!isDomainEventsEnabled(this._config) || !this._domainPublisher) {
      return false;
    }
    const result = await this._domainPublisher.publish(draft);
    if (!result.ok && result.mode !== 'duplicate') {
      // Logger not on every skip — ads volume can be high
    }
    return true;
  }

  /** EDA-008 — impression / clic bannière ou campagne. */
  async publishAdEngagement(
    type: 'ad.impression' | 'ad.click',
    payload: {
      adId: string;
      storeId?: string;
      customerUserId?: string;
      clientInstallId?: string;
      adScope?: 'BANNER' | 'CAMPAIGN';
    },
  ): Promise<void> {
    const eventPayload = {
      adId: payload.adId,
      storeId: payload.storeId,
      customerUserId: payload.customerUserId,
      clientInstallId: payload.clientInstallId,
    };
    const published = await this.publishAdDomainEvent({
      type,
      payload: eventPayload,
      metadata: {
        source: 'ads',
        orderContext: { adScope: payload.adScope ?? 'BANNER' },
      },
    });
    if (published) return;

    if (!shouldEmitLegacyAdWsFromApi(this._config)) return;

    this._wsAdManager.broadcastAdEvent({
      scope: payload.adScope ?? 'BANNER',
      eventType: type === 'ad.impression' ? 'impression' : 'click',
      entityId: payload.adId,
      storeId: payload.storeId,
    });
  }

  /** EDA-008 — conversion post-achat. */
  async publishAdConversion(payload: {
    adId: string;
    storeId?: string;
    orderId?: string;
    customerUserId?: string;
    adScope?: 'BANNER' | 'CAMPAIGN';
  }): Promise<void> {
    const published = await this.publishAdDomainEvent({
      type: 'ad.conversion',
      payload: {
        adId: payload.adId,
        storeId: payload.storeId,
        orderId: payload.orderId,
        customerUserId: payload.customerUserId,
      },
      metadata: {
        source: 'ads',
        orderContext: { adScope: payload.adScope ?? 'BANNER' },
      },
    });
    if (published) return;

    if (!shouldEmitLegacyAdWsFromApi(this._config)) return;

    this._wsAdManager.broadcastAdEvent({
      scope: payload.adScope ?? 'BANNER',
      eventType: 'conversion',
      entityId: payload.adId,
      storeId: payload.storeId,
    });
  }

  private _queueCampaignStatusEmail(args: {
    storeId: string;
    campaignId: string;
    campaignTitle: string;
    previousStatus: AdMarketingEntityStatus;
    newStatus: AdMarketingEntityStatus;
  }): void {
    void this._vendorStatusEmail
      .notifyAdCampaignStatusChange(args)
      .catch(() => undefined);
  }

  private _queueBannerStatusEmail(args: {
    storeId: string;
    bannerId: string;
    bannerTitle: string;
    previousStatus: AdMarketingEntityStatus;
    newStatus: AdMarketingEntityStatus;
  }): void {
    void this._vendorStatusEmail
      .notifyBannerStatusChange(args)
      .catch(() => undefined);
  }

  private _queueAdModerationNotify(args: {
    kind: 'banner' | 'campaign';
    storeId: string;
    entityId: string;
    entityTitle: string;
    previousStatus: AdModerationStatusEnum;
    newStatus: AdModerationStatusEnum;
    rejectionReason?: string | null;
  }): void {
    void this._vendorStatusEmail
      .notifyAdModerationStatusChange(args)
      .catch(() => undefined);
  }

  /** Enqueue immédiat si add-on notifications actif et pub éligible. */
  private scheduleNotificationDispatchAfterSave(
    kind: 'banner' | 'campaign',
    entityId: Types.ObjectId | string | unknown,
    notificationAddon: unknown,
  ): void {
    const addon = notificationAddonFromDoc(
      notificationAddon as Record<string, unknown> | null | undefined,
    );
    if (!addon.enabled) return;
    this._adNotifications.scheduleImmediateDispatch({
      kind,
      entityId: String(entityId),
    });
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

  private moderationStatusFromDoc(
    doc: Record<string, unknown>,
  ): AdModerationStatusEnum {
    const raw = String(doc.moderationStatus ?? doc.moderation_status ?? '')
      .trim()
      .toUpperCase();
    if (raw === AdModerationStatusEnum.PENDING_REVIEW) {
      return AdModerationStatusEnum.PENDING_REVIEW;
    }
    if (raw === AdModerationStatusEnum.REJECTED) {
      return AdModerationStatusEnum.REJECTED;
    }
    if (raw === AdModerationStatusEnum.BLOCKED) {
      return AdModerationStatusEnum.BLOCKED;
    }
    return AdModerationStatusEnum.APPROVED;
  }

  private assertVendorAdNotBlocked(
    user: UserModel,
    moderationStatus: AdModerationStatusEnum | undefined,
  ): void {
    if (user.type !== UserTypeEnum.VENDOR) return;
    if (moderationStatus === AdModerationStatusEnum.BLOCKED) {
      throw new ForbiddenException('ad_blocked');
    }
  }

  private moderationReviewedAtFromDoc(
    doc: Record<string, unknown>,
  ): string | null {
    const raw = doc.reviewedAt ?? doc.reviewed_at;
    if (raw == null || String(raw).trim() === '') return null;
    return raw instanceof Date ? raw.toISOString() : String(raw);
  }

  private rejectionReasonFromDoc(doc: Record<string, unknown>): string | null {
    const raw = doc.rejectionReason ?? doc.rejection_reason;
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw).trim();
  }

  private moderationFieldsForRow(doc: Record<string, unknown>): {
    moderationStatus: AdModerationStatusEnum;
    rejectionReason: string | null;
    reviewedAt: string | null;
  } {
    return {
      moderationStatus: this.moderationStatusFromDoc(doc),
      rejectionReason: this.rejectionReasonFromDoc(doc),
      reviewedAt: this.moderationReviewedAtFromDoc(doc),
    };
  }

  private approvedForPublicModerationFilter(): Record<string, unknown> {
    return {
      $or: [
        { moderationStatus: AdModerationStatusEnum.APPROVED },
        { moderationStatus: { $exists: false } },
        { moderationStatus: null },
      ],
    };
  }

  private vendorRequiresModeration(
    user: UserModel,
    storeId: string | null | undefined,
  ): boolean {
    return user.type === UserTypeEnum.VENDOR && Boolean(storeId);
  }

  /** Lecture robuste des docs `.lean()` (champs camelCase ou snake_case Mongo). */
  private _archivedAtFromLean(doc: Record<string, unknown>): Date | null {
    const raw = doc.archivedAt ?? doc.archived_at;
    if (raw == null || String(raw).trim() === '') return null;
    return raw instanceof Date ? raw : new Date(String(raw));
  }

  private _billingFinalizedFromLean(doc: Record<string, unknown>): boolean {
    const raw = doc.billingFinalizedAt ?? doc.billing_finalized_at;
    return raw != null && String(raw).trim() !== '';
  }

  private _billingFinalAmountFromLean(doc: Record<string, unknown>): number {
    const raw =
      doc.billingFinalAmountCad ??
      doc.billing_final_amount_cad ??
      doc.billingFinalAmount ??
      0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private assertVendorStripeConnectReadyForWrites(user: UserModel): void {
    if (user.type !== UserTypeEnum.VENDOR) return;
    if (
      !isStripeConnectOnboardingCompleteUser(
        user as unknown as Record<string, unknown>,
      )
    ) {
      throw new ForbiddenException('stripe_connect_required');
    }
  }

  /**
   * Bloque la création de nouvelles Ads tant que le crédit Ads finalisé
   * (bannières/campagnes terminées ou expirées) n'est pas soldé.
   */
  private async assertVendorHasNoUnpaidAdCredit(
    user: UserModel,
  ): Promise<void> {
    if (user.type !== UserTypeEnum.VENDOR) return;
    const credit = await this.getMyAdCredit(user);
    if (Number(credit.totalDue ?? 0) > 0) {
      throw new ForbiddenException('ad_credit_payment_required');
    }
  }

  /**
   * Bloque la création / activation si la boutique a atteint la limite
   * de bannières actives définie par son plan.
   */
  private async assertActiveBannerLimit(
    storeId: string,
    user: UserModel,
    opts?: { enforcePlanLimit?: boolean },
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN && !opts?.enforcePlanLimit) return;
    const limit =
      await this._subscriptions.resolveActiveBannerLimitForStore(storeId);
    if (limit == null) return; // illimité
    const now = new Date();
    const count = await this.adModel
      .countDocuments({
        store: new Types.ObjectId(storeId),
        isActive: true,
        ...this.approvedForPublicModerationFilter(),
        $or: [
          { archivedAt: { $exists: false } },
          { archivedAt: null },
        ],
        $and: [
          { $or: [{ validUntil: { $exists: false } }, { validUntil: null }, { validUntil: { $gt: now } }] },
        ],
      })
      .exec();
    if (count >= limit) {
      throw new ForbiddenException(`active_banner_limit_reached:${limit}`);
    }
  }

  /**
   * Bloque la création si la boutique a atteint la limite
   * de campagnes actives (non archivées) définie par son plan.
   */
  private async assertActiveCampaignLimit(
    storeId: string,
    user: UserModel,
    opts?: { enforcePlanLimit?: boolean },
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN && !opts?.enforcePlanLimit) return;
    const limit =
      await this._subscriptions.resolveActiveCampaignLimitForStore(storeId);
    if (limit == null) return; // illimité
    const count = await this._adCampaignModel
      .countDocuments({
        store: new Types.ObjectId(storeId),
        $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
      })
      .exec();
    if (count >= limit) {
      throw new ForbiddenException(`active_campaign_limit_reached:${limit}`);
    }
  }

  private stripe(): StripeClient {
    const key = this._config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException('stripe_not_configured');
    }
    return new Stripe(key);
  }

  private adCreditAdminAppBase(): string {
    return (
      this._config.get<string>('ADMIN_APP_URL')?.trim() ||
      this._config.get<string>('FRONTEND_URL')?.trim() ||
      'http://localhost:3001'
    ).replace(/\/+$/, '');
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
    const adminBase = this.adCreditAdminAppBase();
    return `${adminBase}/ad-credit-return?ad_credit_session_id={CHECKOUT_SESSION_ID}`;
  }

  private adCreditCancelUrl(): string {
    const configured = this._config
      .get<string>('STRIPE_AD_CREDIT_CANCEL_URL')
      ?.trim();
    if (configured) return configured;
    const adminBase = this.adCreditAdminAppBase();
    return `${adminBase}/ad-credit-return?ad_credit_payment=cancel`;
  }

  private async _adCreditPaidTotalCad(
    ownerId: Types.ObjectId,
  ): Promise<number> {
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

  /** Réconcilie les sessions Stripe payées (idempotent). */
  private async _syncAdCreditPaymentsFromStripe(
    ownerId: Types.ObjectId,
  ): Promise<void> {
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
      const amountPaidCad = Number(
        ((session.amount_total ?? 0) / 100).toFixed(2),
      );
      if (!Number.isFinite(amountPaidCad) || amountPaidCad <= 0) continue;
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id ?? null;
      const currency =
        String(session.currency ?? 'cad')
          .trim()
          .toUpperCase() || 'CAD';
      await this._adCreditPaymentModel
        .updateOne(
          { stripeCheckoutSessionId: session.id },
          {
            $set: {
              owner: ownerId,
              amountPaidCad,
              currency,
              status: AdCreditPaymentStatusEnum.PAID,
              stripePaymentIntentId: paymentIntentId,
              paidAt: new Date(),
            },
            $setOnInsert: {
              stripeCheckoutSessionId: session.id,
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

  private _applyCurrencyCreditToStoreRow(
    store: AdCreditSummaryPayload['stores'][number],
    creditCurrency: number,
  ): AdCreditSummaryPayload['stores'][number] {
    let credit = Math.max(0, Number(creditCurrency ?? 0));
    const row = {
      ...store,
      banners: { ...store.banners },
      campaigns: { ...store.campaigns },
      totalDue: Number(store.totalDue ?? 0),
    };
    if (credit <= 0) return row;

    const campaignDue = Math.max(0, Number(row.campaigns.due ?? 0));
    const campaignPaid = Math.min(campaignDue, credit);
    row.campaigns.due = Number((campaignDue - campaignPaid).toFixed(2));
    credit = Number((credit - campaignPaid).toFixed(2));

    if (credit > 0) {
      const bannerDue = Math.max(0, Number(row.banners.due ?? 0));
      const bannerPaid = Math.min(bannerDue, credit);
      row.banners.due = Number((bannerDue - bannerPaid).toFixed(2));
      credit = Number((credit - bannerPaid).toFixed(2));
    }

    row.totalDue = Number((row.campaigns.due + row.banners.due).toFixed(2));
    return row;
  }

  private async _storeAdCashRedeemedCurrency(
    storeId: string,
  ): Promise<number> {
    if (!Types.ObjectId.isValid(storeId)) return 0;
    const rows = await this._storeAdCashModel
      .aggregate<{ _id: null; total: number }>([
        {
          $match: {
            store: new Types.ObjectId(storeId),
            type: StoreAdCashLedgerTypeEnum.REDEMPTION,
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$currencyEquivalent' },
          },
        },
      ])
      .exec();
    return Number(Number(rows[0]?.total ?? 0).toFixed(2));
  }

  private async _storeAdCashBalanceUnits(storeId: string): Promise<number> {
    if (!Types.ObjectId.isValid(storeId)) return 0;
    const storeOid = new Types.ObjectId(storeId);
    const [granted, redeemed] = await Promise.all([
      this._storeAdCashModel
        .aggregate<{ _id: null; total: number }>([
          {
            $match: {
              store: storeOid,
              type: StoreAdCashLedgerTypeEnum.GRANT,
            },
          },
          { $group: { _id: null, total: { $sum: '$adCashAmount' } } },
        ])
        .exec(),
      this._storeAdCashModel
        .aggregate<{ _id: null; total: number }>([
          {
            $match: {
              store: storeOid,
              type: StoreAdCashLedgerTypeEnum.REDEMPTION,
            },
          },
          { $group: { _id: null, total: { $sum: '$adCashAmount' } } },
        ])
        .exec(),
    ]);
    const balance = Number(granted[0]?.total ?? 0) - Number(redeemed[0]?.total ?? 0);
    return Number(Math.max(0, balance).toFixed(4));
  }

  private emptyAdCashStats(): AdminStoreAdSpendingRow['adCash'] {
    return {
      balanceUnits: 0,
      totalReceivedUnits: 0,
      usedUnits: 0,
      balanceCurrencyEquivalent: 0,
      totalReceivedCurrencyEquivalent: 0,
      usedCurrencyEquivalent: 0,
    };
  }

  private async _bulkStoreAdCashStats(
    storeIds: string[],
  ): Promise<Map<string, AdminStoreAdSpendingRow['adCash']>> {
    const out = new Map<string, AdminStoreAdSpendingRow['adCash']>();
    const validIds = storeIds.filter((id) => Types.ObjectId.isValid(id));
    for (const id of validIds) {
      out.set(id, this.emptyAdCashStats());
    }
    if (!validIds.length) return out;

    const oids = validIds.map((id) => new Types.ObjectId(id));
    const grouped = await this._storeAdCashModel
      .aggregate<{
        _id: { store: Types.ObjectId; type: StoreAdCashLedgerTypeEnum };
        adCashUnits: number;
        currencyEquivalent: number;
      }>([
        { $match: { store: { $in: oids } } },
        {
          $group: {
            _id: { store: '$store', type: '$type' },
            adCashUnits: { $sum: '$adCashAmount' },
            currencyEquivalent: { $sum: '$currencyEquivalent' },
          },
        },
      ])
      .exec();

    for (const row of grouped) {
      const storeId = String(row._id.store ?? '');
      if (!storeId || !out.has(storeId)) continue;
      const entry = out.get(storeId)!;
      const units = Number(row.adCashUnits ?? 0);
      const currencyEq = Number(row.currencyEquivalent ?? 0);
      if (row._id.type === StoreAdCashLedgerTypeEnum.GRANT) {
        entry.totalReceivedUnits = Number(
          (entry.totalReceivedUnits + units).toFixed(4),
        );
        entry.totalReceivedCurrencyEquivalent = Number(
          (entry.totalReceivedCurrencyEquivalent + currencyEq).toFixed(2),
        );
      } else if (row._id.type === StoreAdCashLedgerTypeEnum.REDEMPTION) {
        entry.usedUnits = Number((entry.usedUnits + units).toFixed(4));
        entry.usedCurrencyEquivalent = Number(
          (entry.usedCurrencyEquivalent + currencyEq).toFixed(2),
        );
      }
    }

    for (const [storeId, entry] of out.entries()) {
      entry.balanceUnits = Number(
        Math.max(0, entry.totalReceivedUnits - entry.usedUnits).toFixed(4),
      );
    }

    await Promise.all(
      [...out.entries()].map(async ([storeId, entry]) => {
        const ctx = await this._resolveStoreAdCashContext(storeId);
        const rate = ctx?.exchangeRate ?? 1;
        entry.balanceCurrencyEquivalent = Number(
          (entry.balanceUnits * rate).toFixed(2),
        );
      }),
    );

    return out;
  }

  private async _resolveStoreAdCashContext(storeId: string): Promise<{
    storeOid: Types.ObjectId;
    regionCode: string;
    currency: string;
    exchangeRate: number;
  } | null> {
    if (!Types.ObjectId.isValid(storeId)) return null;
    const store = await this._storeModel
      .findById(storeId)
      .select('region currency')
      .lean()
      .exec();
    if (!store) return null;
    const regionCode = String(store.region ?? 'CA')
      .trim()
      .toUpperCase();
    const exchangeRate =
      await this._supportedCountries.getAdCashToCurrencyRate(regionCode);
    const currency =
      (await this._supportedCountries.getCountryCurrency(regionCode)) ||
      String(store.currency ?? 'CAD').toUpperCase();
    return {
      storeOid: new Types.ObjectId(storeId),
      regionCode,
      currency,
      exchangeRate,
    };
  }

  private async _reconcileStoreAdCashForStore(
    storeId: string,
    grossDueCurrency: number,
  ): Promise<void> {
    const grossDue = Math.max(0, Number(grossDueCurrency) || 0);
    if (grossDue <= 0) return;

    const ctx = await this._resolveStoreAdCashContext(storeId);
    if (!ctx) return;

    const [balanceUnits, alreadyRedeemedCurrency] = await Promise.all([
      this._storeAdCashBalanceUnits(storeId),
      this._storeAdCashRedeemedCurrency(storeId),
    ]);
    const pendingDebt = Math.max(0, grossDue - alreadyRedeemedCurrency);
    if (pendingDebt <= 0 || balanceUnits <= 0) return;

    const maxCurrencyFromBalance = Number(
      (balanceUnits * ctx.exchangeRate).toFixed(2),
    );
    const redeemCurrency = Math.min(pendingDebt, maxCurrencyFromBalance);
    const redeemUnits = Number((redeemCurrency / ctx.exchangeRate).toFixed(4));
    if (redeemUnits <= 0 || redeemCurrency <= 0) return;

    const store = await this._storeModel
      .findById(storeId)
      .select('owner')
      .lean()
      .exec();
    if (!store?.owner) return;

    await this._storeAdCashModel.create({
      store: ctx.storeOid,
      owner: store.owner,
      type: StoreAdCashLedgerTypeEnum.REDEMPTION,
      adCashAmount: redeemUnits,
      currencyEquivalent: redeemCurrency,
      exchangeRate: ctx.exchangeRate,
      currency: ctx.currency,
      note: 'auto_settlement_ad_credit',
    });
  }

  private async _reconcileStoreAdCashForStores(
    stores: AdCreditSummaryPayload['stores'],
  ): Promise<void> {
    for (const store of stores) {
      await this._reconcileStoreAdCashForStore(store.storeId, store.totalDue);
    }
  }

  private async _applyRedeemedAdCashToStores(
    stores: AdCreditSummaryPayload['stores'],
  ): Promise<AdCreditSummaryPayload['stores']> {
    const out: AdCreditSummaryPayload['stores'] = [];
    for (const store of stores) {
      const redeemedCurrency = await this._storeAdCashRedeemedCurrency(
        store.storeId,
      );
      out.push(this._applyCurrencyCreditToStoreRow(store, redeemedCurrency));
    }
    return out;
  }

  async getStoreAdCashSummary(
    user: UserModel,
    storeId: string,
  ): Promise<StoreAdCashSummaryPayload> {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException('invalid_store_id');
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('name region currency')
      .lean()
      .exec();
    if (!store) throw new NotFoundException('store_not_found');

    const ctx = await this._resolveStoreAdCashContext(storeId);
    if (!ctx) throw new NotFoundException('store_not_found');

    const [balanceUnits, redeemedCurrency, recentGrants] = await Promise.all([
      this._storeAdCashBalanceUnits(storeId),
      this._storeAdCashRedeemedCurrency(storeId),
      this._storeAdCashModel
        .find({
          store: ctx.storeOid,
          type: StoreAdCashLedgerTypeEnum.GRANT,
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('grantedBy', 'fullName email')
        .lean()
        .exec(),
    ]);

    return {
      storeId,
      storeName: String(store.name ?? storeId),
      regionCode: ctx.regionCode,
      currency: ctx.currency,
      exchangeRate: ctx.exchangeRate,
      balanceAdCash: balanceUnits,
      balanceCurrencyEquivalent: Number(
        (balanceUnits * ctx.exchangeRate).toFixed(2),
      ),
      redeemedCurrency,
      recentGrants: recentGrants.map((row) => {
        const grant = row as StoreAdCashLedgerModel & {
          grantedBy?: { fullName?: string; email?: string } | null;
        };
        const admin = grant.grantedBy;
        const adminLabel =
          typeof admin === 'object' && admin
            ? String(admin.fullName ?? admin.email ?? '')
            : '';
        return {
          id: String(row._id ?? ''),
          adCashAmount: Number(row.adCashAmount ?? 0),
          currencyEquivalent: Number(row.currencyEquivalent ?? 0),
          note: row.note ?? null,
          grantedBy: adminLabel || null,
          createdAt:
            row.createdAt instanceof Date
              ? row.createdAt.toISOString()
              : String(row.createdAt ?? ''),
        };
      }),
    };
  }

  async grantAdCashToStore(
    user: UserModel,
    storeId: string,
    amount: number,
    note?: string,
  ): Promise<StoreAdCashSummaryPayload> {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(storeId)) {
      throw new BadRequestException('invalid_store_id');
    }
    const units = Number(amount);
    if (!Number.isFinite(units) || units <= 0) {
      throw new BadRequestException('invalid_ad_cash_amount');
    }

    const store = await this._storeModel
      .findById(storeId)
      .select('owner name region currency')
      .lean()
      .exec();
    if (!store?.owner) throw new NotFoundException('store_not_found');

    const ctx = await this._resolveStoreAdCashContext(storeId);
    if (!ctx) throw new NotFoundException('store_not_found');

    const currencyEquivalent = Number((units * ctx.exchangeRate).toFixed(2));
    await this._storeAdCashModel.create({
      store: ctx.storeOid,
      owner: store.owner,
      type: StoreAdCashLedgerTypeEnum.GRANT,
      adCashAmount: Number(units.toFixed(4)),
      currencyEquivalent,
      exchangeRate: ctx.exchangeRate,
      currency: ctx.currency,
      grantedBy: user._id,
      note: note?.trim() || null,
    });

    const summary = await this.getStoreAdCashSummary(user, storeId);
    const grantedByName = String(user.fullName ?? user.email ?? '').trim();
    void this._adCashEmail
      .notifyAdCashGranted({
        storeId,
        storeName: String(store.name ?? storeId),
        adCashAmount: Number(units.toFixed(4)),
        currencyEquivalent,
        currency: ctx.currency,
        exchangeRate: ctx.exchangeRate,
        balanceAdCash: summary.balanceAdCash,
        note: note?.trim() || null,
        grantedByName: grantedByName || null,
      })
      .catch(() => undefined);

    return summary;
  }

  private async assertCanManageCampaignStore(
    user: UserModel,
    storeId: string,
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN) return;
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
    await this._storeAccess.assertStoreAccess(
      user,
      storeId,
      'campaigns.manage',
    );
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
      .filter(
        (a) =>
          a.isOwner ||
          storePermissionGranted(a.permissions, 'campaigns.manage'),
      )
      .map((a) => a.storeId)
      .filter((id) => Types.ObjectId.isValid(id));
  }

  private _toPricingPayload(
    doc: AdPricingSettingsModel & Partial<{ updatedAt: Date | string | null }>,
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

  async getPricing(
    user: UserModel,
    countryCode?: string | null,
  ): Promise<AdPricingPayload> {
    this.assertVendorOrAdmin(user);
    return this._regionPricing.getLegacyAdDiffusionPricingPayload(countryCode);
  }

  async updatePricing(
    user: UserModel,
    dto: UpdateAdPricingDto,
    countryCode?: string | null,
  ): Promise<AdPricingPayload> {
    this.assertAdmin(user);
    const code = await this._regionPricing.resolveRegionCode(countryCode);
    return this._regionPricing.saveAdDiffusionPricing(code, dto);
  }

  private async _resolveBillingRegionForAd(
    adId: Types.ObjectId,
  ): Promise<string> {
    const ad = await this.adModel
      .findById(adId)
      .select('region store')
      .lean()
      .exec();
    const fromAd = normalizeCountryCode(
      (ad as { region?: string } | null)?.region,
    );
    if (fromAd) return fromAd;
    const storeRef = (ad as { store?: unknown } | null)?.store;
    if (storeRef) {
      const storeId = String(storeRef);
      if (Types.ObjectId.isValid(storeId)) {
        const fromStore = await this._resolveStoreRegionCode(storeId);
        if (fromStore) return fromStore;
      }
    }
    return this._regionPricing.resolveRegionCode();
  }

  private async _resolveBillingRegionForCampaign(
    campaignId: Types.ObjectId,
  ): Promise<string> {
    const camp = await this._adCampaignModel
      .findById(campaignId)
      .select('store')
      .lean()
      .exec();
    const storeRef = (camp as { store?: unknown } | null)?.store;
    if (storeRef) {
      const storeId = String(storeRef);
      if (Types.ObjectId.isValid(storeId)) {
        const fromStore = await this._resolveStoreRegionCode(storeId);
        if (fromStore) return fromStore;
      }
    }
    return this._regionPricing.resolveRegionCode();
  }

  private _toNotificationPricingPayload(
    doc: AdNotificationPricingSettingsModel &
      Partial<{ updatedAt: Date | string | null }>,
  ): AdNotificationPricingPayload {
    const currency = String(doc.currency ?? AD_NOTIFICATION_PRICING_DEFAULTS.currency)
      .trim()
      .toUpperCase();
    const updatedAt = doc.updatedAt;
    const n = (v: unknown) => {
      const x = Number(v ?? 0);
      return Number.isFinite(x) && x >= 0 ? x : 0;
    };
    return {
      currency: currency || AD_NOTIFICATION_PRICING_DEFAULTS.currency,
      availableChannels: parseAvailableChannelsFromDoc(
        doc as unknown as Record<string, unknown>,
      ),
      emailDeliveryCad: n(doc.emailDeliveryCad),
      emailInteractionCad: n(doc.emailInteractionCad),
      emailConversionCad: n(doc.emailConversionCad),
      pushDeliveryCad: n(doc.pushDeliveryCad),
      pushInteractionCad: n(doc.pushInteractionCad),
      pushConversionCad: n(doc.pushConversionCad),
      inAppDeliveryCad: n(doc.inAppDeliveryCad),
      inAppInteractionCad: n(doc.inAppInteractionCad),
      inAppConversionCad: n(doc.inAppConversionCad),
      smsDeliveryCad: n(doc.smsDeliveryCad),
      smsInteractionCad: n(doc.smsInteractionCad),
      smsConversionCad: n(doc.smsConversionCad),
      whatsappDeliveryCad: n(doc.whatsappDeliveryCad),
      whatsappInteractionCad: n(doc.whatsappInteractionCad),
      whatsappConversionCad: n(doc.whatsappConversionCad),
      updatedAt:
        updatedAt instanceof Date
          ? updatedAt.toISOString()
          : typeof updatedAt === 'string'
          ? updatedAt
          : null,
    };
  }

  private async _getAvailableNotificationChannels(): Promise<AdNotificationChannelAvailabilityPayload> {
    const doc = await this._ensureNotificationPricingDoc();
    return parseAvailableChannelsFromDoc(
      doc as unknown as Record<string, unknown>,
    );
  }

  private async _ensureNotificationPricingDoc(): Promise<AdNotificationPricingSettingsModel> {
    const doc = await this._adNotificationPricingModel
      .findOneAndUpdate(
        { key: AD_NOTIFICATION_PRICING_KEY },
        {
          $setOnInsert: {
            key: AD_NOTIFICATION_PRICING_KEY,
            ...AD_NOTIFICATION_PRICING_DEFAULTS,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as unknown as AdNotificationPricingSettingsModel;
  }

  async getNotificationPricing(
    user: UserModel,
    countryCode?: string | null,
    kind?: 'banner' | 'campaign' | null,
  ): Promise<AdNotificationPricingPayload> {
    this.assertVendorOrAdmin(user);
    return this._regionPricing.getLegacyAdNotificationPricingPayload(
      countryCode,
      kind === 'campaign' ? 'campaign' : 'banner',
    );
  }

  async updateNotificationPricing(
    user: UserModel,
    dto: UpdateAdNotificationPricingDto,
    countryCode?: string | null,
  ): Promise<AdNotificationPricingPayload> {
    this.assertAdmin(user);
    const code = await this._regionPricing.resolveRegionCode(countryCode);
    return this._regionPricing.saveAdNotificationPricing(code, dto);
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
      } else if (
        it.itemType === AdCampaignItemTypeEnum.EXCLUSIVE_OFFER &&
        it.marketingOfferListingId
      ) {
        const key = `E:${it.marketingOfferListingId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          itemType: it.itemType,
          marketingOfferListingId: it.marketingOfferListingId,
        });
      } else if (isCampaignBundleItem(it)) {
        // Combo multi-produit — productBundleId (pas bundleId panier).
        const key = campaignBundleItemKey(it.productBundleId);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          itemType: AdCampaignItemTypeEnum.BUNDLE,
          productBundleId: it.productBundleId.trim(),
        });
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

  async resolveAdCampaignItemLimitForStore(storeId: string): Promise<number> {
    return this._subscriptions.resolveAdCampaignItemLimitForStore(
      storeId,
      AD_CAMPAIGN_MAX_ITEMS,
    );
  }

  async resolveActiveBannerLimitForStore(
    storeId: string,
  ): Promise<number | null> {
    return this._subscriptions.resolveActiveBannerLimitForStore(storeId);
  }

  async resolveActiveCampaignLimitForStore(
    storeId: string,
  ): Promise<number | null> {
    return this._subscriptions.resolveActiveCampaignLimitForStore(storeId);
  }

  /** Limites affichées / appliquées selon le rôle (admin = hors formule vendeur). */
  async resolveAdLimitsForManagementUser(
    user: UserModel,
    storeId: string,
  ): Promise<{
    maxCampaignItems: number;
    maxActiveBanners: number | null;
    maxActiveCampaigns: number | null;
  }> {
    if (user.type === UserTypeEnum.ADMIN) {
      return {
        maxCampaignItems: AD_CAMPAIGN_MAX_ITEMS,
        maxActiveBanners: null,
        maxActiveCampaigns: null,
      };
    }
    const [maxCampaignItems, maxActiveBanners, maxActiveCampaigns] =
      await Promise.all([
        this.resolveAdCampaignItemLimitForStore(storeId),
        this.resolveActiveBannerLimitForStore(storeId),
        this.resolveActiveCampaignLimitForStore(storeId),
      ]);
    return { maxCampaignItems, maxActiveBanners, maxActiveCampaigns };
  }

  private async _assertCampaignItemsBelongToStore(
    storeId: string,
    items: CampaignItemDto[],
    user: UserModel,
  ): Promise<void> {
    const normalized = this._normalizeCampaignItems(items);
    if (!normalized.length) {
      throw new BadRequestException('campaign_items_required');
    }
    const maxItems =
      user.type === UserTypeEnum.ADMIN
        ? AD_CAMPAIGN_MAX_ITEMS
        : await this.resolveAdCampaignItemLimitForStore(storeId);
    if (normalized.length > maxItems) {
      throw new BadRequestException(`campaign_items_max_exceeded:${maxItems}`);
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
    const listingIds = normalized
      .filter((i) => i.itemType === AdCampaignItemTypeEnum.EXCLUSIVE_OFFER)
      .map((i) => i.marketingOfferListingId!)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (listingIds.length > 0) {
      await this.assertExclusiveOfferListingsBelongToStore(storeId, listingIds);
    }
    // Bundles : doivent appartenir à la boutique de la campagne.
    const bundleIds = normalized
      .filter((i) => i.itemType === AdCampaignItemTypeEnum.BUNDLE)
      .map((i) => i.productBundleId!)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (bundleIds.length > 0) {
      const count = await this._productBundleModel
        .countDocuments({
          _id: { $in: bundleIds },
          storeId: new Types.ObjectId(storeId),
        })
        .exec();
      if (count !== bundleIds.length) {
        throw new BadRequestException('campaign_bundle_not_in_store');
      }
    }
  }

  private _catalogCommissionStrategy(
    entity: Record<string, unknown> | null | undefined,
  ): 'on_payout' | 'add_to_price' | null {
    if (!entity) return null;
    const raw =
      entity['commissionRetrieveStrategy'] ??
      entity['commission_retrieve_strategy'];
    return raw === 'add_to_price' || raw === 'on_payout' ? raw : null;
  }

  private async _applyCustomerPricingToCampaignItems(
    row: AdCampaignManagementRow,
    itemStrategies: Array<'on_payout' | 'add_to_price' | null>,
  ): Promise<void> {
    if (!row.items.length || !row.storeId) return;
    const pricingRows: Array<Record<string, unknown>> = row.items.map(
      (it, i) => ({
        priceCad: it.priceCad,
        storeId: row.storeId,
        commissionRetrieveStrategy: itemStrategies[i] ?? null,
      }),
    );
    await this._planOrderCommission.applyCustomerCatalogListPricing(
      pricingRows,
      {
        priceKey: 'priceCad',
        discountKey: null,
        getStoreId: (r) => String(r['storeId'] ?? ''),
        getItemStrategy: (r) => {
          const s = r['commissionRetrieveStrategy'];
          return s === 'add_to_price' || s === 'on_payout' ? s : null;
        },
      },
    );
    for (let i = 0; i < row.items.length; i++) {
      row.items[i] = {
        ...row.items[i],
        priceCad: Number(pricingRows[i]['priceCad'] ?? 0),
      };
    }
  }

  private async _toCampaignRow(
    doc: Record<string, unknown>,
  ): Promise<AdCampaignManagementRow> {
    const rawStore = doc.store as Record<string, unknown> | undefined | null;
    const storeId = String(rawStore?._id ?? '');
    const storeName = String(rawStore?.name ?? '').trim() || storeId;
    const storeProfileImageUrl = rawStore?.profileImage
      ? String(rawStore.profileImage)
      : null;
    const rawItems = Array.isArray(doc.items)
      ? (doc.items as Record<string, unknown>[])
      : [];
    const built: Array<{
      item: AdCampaignItemRow;
      strategy: 'on_payout' | 'add_to_price' | null;
    }> = [];
    for (const it of rawItems) {
      const itemType = it.itemType as AdCampaignItemTypeEnum;
      const p = it.product as Record<string, unknown> | undefined | null;
      const d = it.drink as Record<string, unknown> | undefined | null;
      if (itemType === AdCampaignItemTypeEnum.PRODUCT) {
        const productId = p?._id ? String(p._id) : null;
        if (!productId) continue;
        built.push({
          strategy: this._catalogCommissionStrategy(p),
          item: {
            itemType,
            productId,
            drinkId: null,
            marketingOfferListingId: null,
            productBundleId: null,
            title: String(p?.title ?? '(produit supprimé)'),
            imageUrl: p?.profileImage ? String(p.profileImage) : null,
            priceCad: Number(p?.price ?? 0),
          },
        });
        continue;
      }
      if (itemType === AdCampaignItemTypeEnum.EXCLUSIVE_OFFER) {
        const listing = it.marketingOfferListing as
          | Record<string, unknown>
          | undefined
          | null;
        const product = listing?.productId as
          | Record<string, unknown>
          | undefined
          | null;
        const offer = listing?.marketingOfferId as
          | Record<string, unknown>
          | undefined
          | null;
        const listingId = listing?._id ? String(listing._id) : null;
        if (!listingId) continue;
        const strategyName = offer?.name ? String(offer.name) : null;
        const productTitle = product?.title ? String(product.title) : '';
        built.push({
          strategy: this._catalogCommissionStrategy(product),
          item: {
            itemType,
            productId: null,
            drinkId: null,
            marketingOfferListingId: listingId,
            productBundleId: null,
            title:
              strategyName && productTitle
                ? `${strategyName} — ${productTitle}`
                : productTitle ||
                  strategyName ||
                  '(offre exclusive supprimée)',
            imageUrl: product?.profileImage
              ? String(product.profileImage)
              : null,
            priceCad: Number(product?.price ?? 0),
            strategyName,
          },
        });
        continue;
      }
      if (itemType === AdCampaignItemTypeEnum.BUNDLE) {
        const b = it.productBundle as Record<string, unknown> | undefined | null;
        const productBundleId = b?._id ? String(b._id) : null;
        if (!productBundleId) continue;
        const nameFr = String(b?.nameFr ?? '').trim();
        const nameEn = String(b?.nameEn ?? '').trim();
        built.push({
          strategy: null,
          item: {
            itemType,
            productId: null,
            drinkId: null,
            marketingOfferListingId: null,
            productBundleId,
            title: nameFr || nameEn || '(bundle supprimé)',
            imageUrl: b?.image ? String(b.image) : null,
            // Prix affiché côté admin/feed ; calcul précis via pricing catalogue local.
            priceCad: 0,
          },
        });
        continue;
      }
      const drinkId = d?._id ? String(d._id) : null;
      if (!drinkId) continue;
      built.push({
        strategy: this._catalogCommissionStrategy(d),
        item: {
          itemType: AdCampaignItemTypeEnum.DRINK,
          productId: null,
          drinkId,
          marketingOfferListingId: null,
          productBundleId: null,
          title: String(d?.name ?? '(boisson supprimée)'),
          imageUrl: d?.imageUrl ? String(d.imageUrl) : null,
          priceCad: Number(d?.priceCad ?? 0),
        },
      });
    }
    const items = built.map((b) => b.item);
    const itemStrategies = built.map((b) => b.strategy);

    const row: AdCampaignManagementRow = {
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
          ? (String(doc.archiveReason)
              .trim()
              .toUpperCase() as AdCampaignArchiveReasonEnum)
          : null,
      billingFinalizedAt:
        doc.billingFinalizedAt instanceof Date
          ? doc.billingFinalizedAt.toISOString()
          : doc.billingFinalizedAt != null
          ? String(doc.billingFinalizedAt)
          : null,
      billingFinalAmountCad: Number(doc.billingFinalAmountCad ?? 0),
      audienceTotal: audienceTotalFromDoc(doc),
      notificationAddon: notificationAddonFromDoc(
        (doc.notificationAddon ?? doc.notification_addon) as
          | Record<string, unknown>
          | undefined,
      ),
      ...this.moderationFieldsForRow(doc),
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
    await this._applyCustomerPricingToCampaignItems(row, itemStrategies);
    return row;
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
        itemType: {
          $in: [
            AdCampaignItemTypeEnum.PRODUCT,
            AdCampaignItemTypeEnum.DRINK,
            AdCampaignItemTypeEnum.EXCLUSIVE_OFFER,
            AdCampaignItemTypeEnum.BUNDLE,
          ],
        },
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
    metrics: {
      impressions: number;
      clicks: number;
      actionClicks: number;
      conversions: number;
    },
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
    const billingRegion =
      await this._resolveBillingRegionForCampaign(campaignId);
    const pricing = await this._regionPricing.getLegacyAdDiffusionPricingPayload(
      billingRegion,
    );
    const metrics = await this._campaignBillingMetrics(campaignId);
    const displayAmount = this._campaignBillingAmount(pricing, metrics);

    const campDoc = await this._adCampaignModel
      .findById(campaignId)
      .select('notificationAddon')
      .lean()
      .exec();
    const addon = notificationAddonFromDoc(
      (campDoc as { notificationAddon?: unknown } | null)?.notificationAddon as
        | Record<string, unknown>
        | undefined,
    );
    let notificationAmountCad = 0;
    let notificationBlock: Record<string, unknown> | null = null;
    if (addon.enabled) {
      const notifPricing =
        await this._regionPricing.getLegacyAdNotificationPricingPayload(
          billingRegion,
          'campaign',
        );
      const notifMetrics =
        await this._adNotifications.aggregateMetricsForCampaign(campaignId);
      notificationAmountCad = this._adNotifications.computeNotificationAmount(
        notifMetrics,
        notifPricing,
      );
      notificationBlock = {
        metrics: notifMetrics,
        pricing: notifPricing,
        amountCad: notificationAmountCad,
      };
    }

    const finalAmount = displayAmount + notificationAmountCad;
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
              displayAmountCad: Number(displayAmount.toFixed(2)),
              notification: notificationBlock,
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
    const existing = await this._adCampaignModel
      .findById(campaignId)
      .select('store title isActive startsAt endsAt archivedAt archiveReason')
      .lean()
      .exec();
    if (!existing || this._archivedAtFromLean(existing as Record<string, unknown>)) {
      return;
    }
    const previousStatus = VendorStatusEmailService.resolveCampaignStatus({
      isActive: Boolean(existing.isActive),
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      archivedAt: existing.archivedAt,
      archiveReason: existing.archiveReason,
    });
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
    const newStatus: AdMarketingEntityStatus =
      opts?.reason === AdCampaignArchiveReasonEnum.EXPIRED ? 'expired' : 'ended';
    this._queueCampaignStatusEmail({
      storeId: String(existing.store),
      campaignId: String(campaignId),
      campaignTitle: String(existing.title ?? ''),
      previousStatus,
      newStatus,
    });
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
    const billingRegion = await this._resolveBillingRegionForAd(adId);
    const pricing = await this._regionPricing.getLegacyAdDiffusionPricingPayload(
      billingRegion,
    );
    const metrics = await this._adBillingMetrics(adId);
    const displayAmount = this._adBillingAmount(pricing, metrics);

    const adDoc = await this.adModel
      .findById(adId)
      .select('notificationAddon')
      .lean()
      .exec();
    const addon = notificationAddonFromDoc(
      (adDoc as { notificationAddon?: unknown } | null)?.notificationAddon as
        | Record<string, unknown>
        | undefined,
    );
    let notificationAmountCad = 0;
    let notificationBlock: Record<string, unknown> | null = null;
    if (addon.enabled) {
      const notifPricing =
        await this._regionPricing.getLegacyAdNotificationPricingPayload(
          billingRegion,
          'banner',
        );
      const notifMetrics =
        await this._adNotifications.aggregateMetricsForAd(adId);
      notificationAmountCad = this._adNotifications.computeNotificationAmount(
        notifMetrics,
        notifPricing,
      );
      notificationBlock = {
        metrics: notifMetrics,
        pricing: notifPricing,
        amountCad: notificationAmountCad,
      };
    }

    const finalAmount = displayAmount + notificationAmountCad;
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
              displayAmountCad: Number(displayAmount.toFixed(2)),
              notification: notificationBlock,
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
    const existing = await this.adModel
      .findById(adId)
      .select('store title isActive validFrom validUntil archivedAt archiveReason')
      .lean()
      .exec();
    if (!existing || this._archivedAtFromLean(existing as Record<string, unknown>)) {
      return;
    }
    const previousStatus = VendorStatusEmailService.resolveBannerStatus({
      isActive: Boolean(existing.isActive),
      validFrom: existing.validFrom,
      validUntil: existing.validUntil,
      archivedAt: existing.archivedAt,
      archiveReason: existing.archiveReason,
    });
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
    try {
      await this._finalizeAdBilling(adId);
    } catch {
      /* Archivage conservé même si la clôture billing échoue (retry possible). */
    }
    const storeId = existing.store != null ? String(existing.store) : '';
    if (storeId) {
      const newStatus: AdMarketingEntityStatus =
        opts?.reason === AdArchiveReasonEnum.EXPIRED ? 'expired' : 'ended';
      this._queueBannerStatusEmail({
        storeId,
        bannerId: String(adId),
        bannerTitle: String(existing.title ?? ''),
        previousStatus,
        newStatus,
      });
    }
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
    const manageableStoreIds = await this.resolveManageableCampaignStoreIds(
      user,
    );
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
      .populate('items.product', 'title profileImage price store commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad store commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .populate({
        path: 'items.marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title profileImage price commissionRetrieveStrategy' },
          { path: 'marketingOfferId', select: 'name rule type' },
        ],
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return Promise.all(
      (docs as Record<string, unknown>[]).map((d) => this._toCampaignRow(d)),
    );
  }

  async listArchivedCampaignsForManagement(
    user: UserModel,
  ): Promise<AdCampaignManagementRow[]> {
    this.assertVendorOrAdmin(user);
    await this._autoArchiveExpiredCampaigns();
    const manageableStoreIds = await this.resolveManageableCampaignStoreIds(
      user,
    );
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
      .populate('items.product', 'title profileImage price store commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad store commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .populate({
        path: 'items.marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title profileImage price commissionRetrieveStrategy' },
          { path: 'marketingOfferId', select: 'name rule type' },
        ],
      })
      .sort({ archivedAt: -1, createdAt: -1 })
      .lean()
      .exec();
    return Promise.all(
      (docs as Record<string, unknown>[]).map((d) => this._toCampaignRow(d)),
    );
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
    await this._subscriptions.assertMarketingToolsEnabledForStore(storeId, user);
    await this.assertActiveCampaignLimit(storeId, user);
    const requiresModeration = user.type === UserTypeEnum.VENDOR;
    const moderationStatus = requiresModeration
      ? AdModerationStatusEnum.PENDING_REVIEW
      : AdModerationStatusEnum.APPROVED;
    const isActive = requiresModeration ? false : dto.isActive !== false;
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this._assertCampaignDateRange(startsAt, endsAt);
    await this._assertCampaignItemsBelongToStore(storeId, dto.items, user);
    const actionType = dto.actionType ?? StoreAdActionTypeEnum.SHOP;
    if (actionType === StoreAdActionTypeEnum.PRODUCT) {
      throw new BadRequestException('invalid_campaign_action_type');
    }
    const actionText =
      String(dto.actionText ?? 'Découvrir').trim() || 'Découvrir';
    let actionTarget: string | undefined;
    if (isAdLinkActionType(actionType)) {
      actionTarget = this.assertActionTargetValue(actionType, dto.actionTarget);
    } else if (actionType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER) {
      const listingId = String(dto.actionTarget ?? '').trim();
      if (!listingId || !Types.ObjectId.isValid(listingId)) {
        throw new BadRequestException('exclusive_offer_listing_required');
      }
      await this.assertExclusiveOfferListingsBelongToStore(storeId, [listingId]);
      actionTarget = listingId;
    }
    const items = this._campaignItemsToDb(dto.items);
    const channelAvailability = await this._getAvailableNotificationChannels();
    const created = await this._adCampaignModel.create({
      store: new Types.ObjectId(storeId),
      title: dto.title.trim(),
      subtitle: dto.subtitle?.trim() || '',
      description: dto.description?.trim() || '',
      startsAt,
      endsAt,
      isActive,
      moderationStatus,
      actionType,
      actionText,
      actionTarget: actionTarget || undefined,
      items,
      audienceTotal: normalizeAudienceTotal(dto.audienceTotal) ?? null,
      notificationAddon: normalizeNotificationAddonInput(
        dto.notificationAddon,
        channelAvailability,
      ),
    });
    if (moderationStatus === AdModerationStatusEnum.APPROVED) {
      this.scheduleNotificationDispatchAfterSave(
        'campaign',
        created._id,
        created.notificationAddon,
      );
    }
    const row = await this._adCampaignModel
      .findById(created._id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad store commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .populate({
        path: 'items.marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title profileImage price commissionRetrieveStrategy' },
          { path: 'marketingOfferId', select: 'name rule type' },
        ],
      })
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
    if (user.type === UserTypeEnum.VENDOR) {
      await this._subscriptions.assertMarketingToolsEnabledForStore(
        existingStoreId,
        user,
      );
    }
    if (user.type === UserTypeEnum.VENDOR) {
      this.assertVendorAdNotBlocked(user, existing.moderationStatus);
      if (
        dto.isActive === true &&
        existing.moderationStatus !== AdModerationStatusEnum.APPROVED
      ) {
        throw new ForbiddenException('ad_moderation_required');
      }
      if (existing.moderationStatus === AdModerationStatusEnum.REJECTED) {
        existing.moderationStatus = AdModerationStatusEnum.PENDING_REVIEW;
        existing.rejectionReason = undefined;
        existing.reviewedAt = null;
        existing.reviewedBy = null;
        existing.isActive = false;
      }
    }
    const previousCampaignStatus = VendorStatusEmailService.resolveCampaignStatus({
      isActive: Boolean(existing.isActive),
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      archivedAt: existing.archivedAt,
      archiveReason: existing.archiveReason,
    });
    if (dto.title != null) existing.title = dto.title.trim();
    if (dto.subtitle != null) existing.subtitle = dto.subtitle.trim();
    if (dto.description != null) existing.description = dto.description.trim();
    if (dto.isActive != null) existing.isActive = dto.isActive;
    // Début/fin verrouillés une fois le couple posé (création seule).
    const hadBothCampaignDates = Boolean(existing.startsAt && existing.endsAt);
    if (dto.startsAt != null) {
      if (hadBothCampaignDates) {
        const existingStart = new Date(existing.startsAt as Date).getTime();
        const proposedStart = new Date(dto.startsAt).getTime();
        if (
          !Number.isNaN(existingStart) &&
          !Number.isNaN(proposedStart) &&
          existingStart !== proposedStart
        ) {
          throw new BadRequestException('campaign_start_date_locked');
        }
      } else {
        existing.startsAt = new Date(dto.startsAt);
      }
    }
    if (dto.endsAt != null) {
      if (hadBothCampaignDates) {
        const existingEnd = new Date(existing.endsAt as Date).getTime();
        const proposedEnd = new Date(dto.endsAt).getTime();
        if (
          !Number.isNaN(existingEnd) &&
          !Number.isNaN(proposedEnd) &&
          existingEnd !== proposedEnd
        ) {
          throw new BadRequestException('campaign_end_date_locked');
        }
      } else {
        existing.endsAt = new Date(dto.endsAt);
      }
    }
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
      (existing.actionType as StoreAdActionTypeEnum) ??
      StoreAdActionTypeEnum.SHOP;
    if (isAdLinkActionType(effectiveActionType)) {
      existing.actionTarget = this.assertActionTargetValue(
        effectiveActionType,
        existing.actionTarget,
      );
    } else if (effectiveActionType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER) {
      const listingId = String(existing.actionTarget ?? '').trim();
      if (!listingId || !Types.ObjectId.isValid(listingId)) {
        throw new BadRequestException('exclusive_offer_listing_required');
      }
      await this.assertExclusiveOfferListingsBelongToStore(
        existingStoreId,
        [listingId],
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
      await this._assertCampaignItemsBelongToStore(sid, dto.items, user);
      existing.items = this._campaignItemsToDb(dto.items);
    }
    if (dto.audienceTotal !== undefined) {
      existing.audienceTotal = normalizeAudienceTotal(dto.audienceTotal) ?? null;
    }
    if (dto.notificationAddon !== undefined) {
      const channelAvailability = await this._getAvailableNotificationChannels();
      existing.notificationAddon = normalizeNotificationAddonInput(
        dto.notificationAddon,
        channelAvailability,
      );
      if (existing.moderationStatus === AdModerationStatusEnum.APPROVED) {
        this.scheduleNotificationDispatchAfterSave(
          'campaign',
          existing._id,
          existing.notificationAddon,
        );
      }
    }
    await existing.save();
    const newCampaignStatus = VendorStatusEmailService.resolveCampaignStatus({
      isActive: Boolean(existing.isActive),
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      archivedAt: existing.archivedAt,
      archiveReason: existing.archiveReason,
    });
    this._queueCampaignStatusEmail({
      storeId: existingStoreId,
      campaignId: String(existing._id),
      campaignTitle: String(existing.title ?? ''),
      previousStatus: previousCampaignStatus,
      newStatus: newCampaignStatus,
    });
    const row = await this._adCampaignModel
      .findById(existing._id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad store commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .populate({
        path: 'items.marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title profileImage price commissionRetrieveStrategy' },
          { path: 'marketingOfferId', select: 'name rule type' },
        ],
      })
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
      .select('_id store archivedAt billingFinalizedAt moderationStatus')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    await this.assertCanManageCampaignStore(user, String(existing.store));
    const lean = existing as unknown as Record<string, unknown>;
    this.assertVendorAdNotBlocked(
      user,
      this.moderationStatusFromDoc(lean),
    );
    const campaignOid = new Types.ObjectId(String(existing._id));
    if (!this._archivedAtFromLean(lean)) {
      await this._archiveCampaignById(campaignOid, {
        forceEndsNow: true,
        reason: AdCampaignArchiveReasonEnum.ENDED,
      });
    } else if (!this._billingFinalizedFromLean(lean)) {
      await this._finalizeCampaignBilling(campaignOid);
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
        String(
          (out as { archivedAt?: Date | string } | null)?.archivedAt ??
            new Date(),
        ),
      ).toISOString(),
    };
  }

  async removeCampaign(user: UserModel, id: string): Promise<void> {
    this.assertVendorOrAdmin(user);
    this.assertVendorStripeConnectReadyForWrites(user);
    const existing = await this._adCampaignModel
      .findById(id)
      .select('store moderationStatus')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    await this.assertCanManageCampaignStore(user, String(existing.store));
    this.assertVendorAdNotBlocked(
      user,
      this.moderationStatusFromDoc(existing as unknown as Record<string, unknown>),
    );
    const res = await this._adCampaignModel.deleteOne({ _id: id }).exec();
    if (!res.deletedCount) {
      throw new NotFoundException('campaign_not_found');
    }
  }

  async listCampaignsPublic(
    clientRegion?: string,
  ): Promise<{ items: PublicAdCampaignRow[] }> {
    const filterRegion = normalizeCountryCode(clientRegion ?? '') || undefined;
    await this._autoArchiveExpiredCampaigns();
    const now = new Date();
    const docs = await this._adCampaignModel
      .find({
        $and: [
          {
            $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
          },
          this.approvedForPublicModerationFilter(),
          { isActive: true },
          { startsAt: { $lte: now } },
          { endsAt: { $gte: now } },
        ],
      })
      .populate('store', 'name status profileImage')
      .populate('items.product', 'title profileImage price status commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .populate({
        path: 'items.marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title profileImage price commissionRetrieveStrategy' },
          { path: 'marketingOfferId', select: 'name rule type' },
        ],
      })
      .sort({ startsAt: -1, createdAt: -1 })
      .lean()
      .exec();
    const rows = (
      await Promise.all(
        (docs as Record<string, unknown>[]).map((d) => this._toCampaignRow(d)),
      )
    ).filter((row) => row.items.length > 0);
    const storeIds = [
      ...new Set(rows.map((row) => row.storeId).filter(Boolean)),
    ];
    const regionByStoreId = await this._storeRegionsById(storeIds);
    const filtered = rows.filter((row) => {
      if (!filterRegion) return true;
      const storeRegion = regionByStoreId.get(row.storeId);
      if (!storeRegion) return false;
      return this._matchesClientRegion(filterRegion, storeRegion);
    });
    return {
      items: filtered.map((row) => ({
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
        $and: [
          {
            $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
          },
          this.approvedForPublicModerationFilter(),
          { isActive: true },
          { startsAt: { $lte: now } },
          { endsAt: { $gte: now } },
        ],
      })
      .select('_id store')
      .lean()
      .exec();
    if (!campaign) {
      throw new NotFoundException('campaign_not_found');
    }

    const itemType = String(dto.itemType ?? '')
      .trim()
      .toUpperCase();
    if (
      itemType !== AdCampaignItemTypeEnum.PRODUCT &&
      itemType !== AdCampaignItemTypeEnum.DRINK &&
      itemType !== AdCampaignItemTypeEnum.EXCLUSIVE_OFFER &&
      itemType !== AdCampaignItemTypeEnum.BUNDLE &&
      itemType !== 'STORE_ACTION'
    ) {
      throw new BadRequestException('invalid_campaign_item_type');
    }
    const itemId = String(dto.itemId ?? '').trim();
    if (!itemId || !Types.ObjectId.isValid(itemId)) {
      throw new BadRequestException('invalid_campaign_item_id');
    }
    if (itemType === 'STORE_ACTION') {
      const campaignStoreId = String(
        (campaign as { store?: unknown }).store ?? '',
      );
      if (!campaignStoreId || campaignStoreId !== itemId) {
        throw new BadRequestException('campaign_item_not_found');
      }
    } else {
      const elemMatch =
        itemType === AdCampaignItemTypeEnum.PRODUCT
          ? { itemType, product: new Types.ObjectId(itemId) }
          : itemType === AdCampaignItemTypeEnum.DRINK
            ? { itemType, drink: new Types.ObjectId(itemId) }
            : itemType === AdCampaignItemTypeEnum.BUNDLE
              ? {
                  itemType: AdCampaignItemTypeEnum.BUNDLE,
                  productBundle: new Types.ObjectId(itemId),
                }
              : {
                  itemType: AdCampaignItemTypeEnum.EXCLUSIVE_OFFER,
                  marketingOfferListing: new Types.ObjectId(itemId),
                };
      const existsInCampaign = await this._adCampaignModel
        .exists({
          _id: new Types.ObjectId(campaignId),
          items: { $elemMatch: elemMatch },
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
    const storeId =
      String((campaign as { store?: unknown }).store ?? '') || undefined;
    const uid =
      user && (user as UserModel)._id
        ? String((user as UserModel)._id)
        : undefined;
    if (
      dto.eventType === AdCampaignEventTypeEnum.IMPRESSION ||
      dto.eventType === AdCampaignEventTypeEnum.CLICK
    ) {
      await this.publishAdEngagement(
        dto.eventType === AdCampaignEventTypeEnum.IMPRESSION
          ? 'ad.impression'
          : 'ad.click',
        {
          adId: campaignId,
          storeId,
          customerUserId: uid,
          clientInstallId: dto.clientInstallId?.trim(),
          adScope: 'CAMPAIGN',
        },
      );
    }

    return { ok: true };
  }

  async trackOrderConversions(args: {
    orderId: string;
    userId: string;
    storeId: string;
    items: Array<{ itemType: string; entityId: string }>;
  }): Promise<{
    ok: true;
    bannerConversions: number;
    campaignConversions: number;
  }> {
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
        itemType: String(it.itemType ?? '')
          .trim()
          .toUpperCase(),
        itemId: String(it.entityId ?? '').trim(),
      }))
      .filter(
        (it) =>
          (it.itemType === AdCampaignItemTypeEnum.PRODUCT ||
            it.itemType === AdCampaignItemTypeEnum.DRINK ||
            it.itemType === AdCampaignItemTypeEnum.EXCLUSIVE_OFFER) &&
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
          $in: [
            AdCampaignItemTypeEnum.PRODUCT,
            AdCampaignItemTypeEnum.DRINK,
            AdCampaignItemTypeEnum.EXCLUSIVE_OFFER,
            // Clics bundle : attribution si la commande expose BUNDLE:id (sinon match plats/boissons).
            AdCampaignItemTypeEnum.BUNDLE,
          ],
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
            `${String(row.campaign ?? '')}:${String(
              row.itemType ?? '',
            ).toUpperCase()}:${String(row.itemId ?? '')}`,
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
        const itemType = String(click.itemType ?? '')
          .trim()
          .toUpperCase();
        const itemId = String(click.itemId ?? '').trim();
        if (
          !Types.ObjectId.isValid(campaignId) ||
          !Types.ObjectId.isValid(itemId)
        ) {
          continue;
        }
        if (campaignStoreById.get(campaignId) !== storeOid.toHexString()) {
          continue;
        }
        const orderItemKey = `${itemType}:${itemId}`;
        if (
          !purchasedByKey.has(orderItemKey) ||
          seenOrderItemKeys.has(orderItemKey)
        ) {
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
          (Types.ObjectId.isValid(adProductId) &&
            purchasedProducts.has(adProductId)) ||
          (Types.ObjectId.isValid(adStoreId) &&
            adStoreId === storeOid.toHexString()) ||
          (!Types.ObjectId.isValid(adProductId) &&
            !Types.ObjectId.isValid(adStoreId));
        if (!eligible) continue;
        const conversionSource =
          Types.ObjectId.isValid(adProductId) &&
          purchasedProducts.has(adProductId)
            ? AdConversionSourceEnum.BANNER_PRODUCT
            : Types.ObjectId.isValid(adStoreId) &&
              adStoreId === storeOid.toHexString()
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
        void this.publishAdConversion({
          adId,
          storeId: storeOid.toHexString(),
          orderId,
          customerUserId: userId,
          adScope: 'BANNER',
        });
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
      .map((a) => ({
        storeId: a.storeId,
        storeName: a.storeName || a.storeId,
      }));
    const storeIds = storeMeta.map((a) => new Types.ObjectId(a.storeId));

    if (!storeIds.length) {
      const ownerId = new Types.ObjectId(String(user._id));
      let paidTotal = await this._adCreditPaidTotalCad(ownerId);
      await this._syncAdCreditPaymentsFromStripe(ownerId);
      paidTotal = await this._adCreditPaidTotalCad(ownerId);
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
      }
    >();
    for (const s of storeMeta) {
      perStore.set(s.storeId, {
        storeName: s.storeName,
        banners: { impressions: 0, clicks: 0, conversions: 0, due: 0 },
        campaigns: {
          impressions: 0,
          clicks: 0,
          actionClicks: 0,
          conversions: 0,
          due: 0,
        },
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

    const [bannerImpressions, bannerClicks, bannerConversions, bannerAgg] =
      adObjectIds.length
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
              .aggregate<{
                _id: { ad: Types.ObjectId; eventType: AdEventTypeEnum };
                count: number;
              }>([
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
      const isArchived = this._archivedAtFromLean(doc) != null;
      const due = isArchived
        ? Number(
            this._billingFinalAmountFromLean(doc) ||
              this._adBillingAmount(pricing, metrics),
          )
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
    ] = campaignObjectIds.length
      ? await Promise.all([
          this._adCampaignEventModel.countDocuments({
            campaign: { $in: campaignObjectIds },
            eventType: AdCampaignEventTypeEnum.IMPRESSION,
          }),
          this._adCampaignEventModel.countDocuments({
            campaign: { $in: campaignObjectIds },
            eventType: AdCampaignEventTypeEnum.CLICK,
            itemType: {
              $in: [
                AdCampaignItemTypeEnum.PRODUCT,
                AdCampaignItemTypeEnum.DRINK,
              ],
            },
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
            .aggregate<{
              _id: {
                campaign: Types.ObjectId;
                eventType: AdCampaignEventTypeEnum;
                itemType: string;
              };
              count: number;
            }>([
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

    const bannersDue = [...bannerDueByStore.values()].reduce(
      (acc, v) => acc + v,
      0,
    );
    const campaignMetricsById = new Map<
      string,
      {
        impressions: number;
        clicks: number;
        actionClicks: number;
        conversions: number;
      }
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
      if (
        !Types.ObjectId.isValid(campaignId) ||
        !Types.ObjectId.isValid(storeId)
      ) {
        continue;
      }
      const metrics = campaignMetricsById.get(campaignId) ?? {
        impressions: 0,
        clicks: 0,
        actionClicks: 0,
        conversions: 0,
      };
      const isArchived = this._archivedAtFromLean(doc) != null;
      const due = isArchived
        ? Number(
            this._billingFinalAmountFromLean(doc) ||
              this._campaignBillingAmount(pricing, metrics),
          )
        : 0;
      campaignDueByStore.set(
        storeId,
        (campaignDueByStore.get(storeId) ?? 0) + due,
      );
    }
    const campaignsDue = [...campaignDueByStore.values()].reduce(
      (acc, v) => acc + v,
      0,
    );
    const grossDue = Number((bannersDue + campaignsDue).toFixed(2));

    const stores = [...perStore.entries()].map(([storeId, row]) => {
      const bannerDue = bannerDueByStore.get(storeId) ?? 0;
      const campaignDue = campaignDueByStore.get(storeId) ?? 0;
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
    await this._syncAdCreditPaymentsFromStripe(ownerId);
    let paidTotal = await this._adCreditPaidTotalCad(ownerId);
    await this._reconcileStoreAdCashForStores(stores);
    const storesAfterAdCash = await this._applyRedeemedAdCashToStores(stores);
    const applied = this.applyPaidAmountToStoreBreakdown(
      storesAfterAdCash,
      paidTotal,
    );
    const grossByStoreId = new Map(
      stores.map((row) => [row.storeId, row.totalDue]),
    );
    const enrichedStores = await Promise.all(
      applied.stores.map(async (store) => {
        const grossStoreDue = grossByStoreId.get(store.storeId) ?? store.totalDue;
        const balanceUnits = await this._storeAdCashBalanceUnits(store.storeId);
        const ctx = await this._resolveStoreAdCashContext(store.storeId);
        const exchangeRate = ctx?.exchangeRate ?? 1;
        const balanceCurrency = Number(
          (balanceUnits * exchangeRate).toFixed(2),
        );
        const payableCurrency = Number(
          Math.min(store.totalDue, balanceCurrency).toFixed(2),
        );
        return {
          ...store,
          grossDue: Number(grossStoreDue.toFixed(2)),
          adCash: {
            balanceUnits,
            exchangeRate,
            balanceCurrencyEquivalent: balanceCurrency,
            payableCurrency,
          },
        };
      }),
    );
    const adCashTotals = enrichedStores.reduce(
      (acc, row) => ({
        totalBalanceCurrency:
          acc.totalBalanceCurrency +
          Number(row.adCash?.balanceCurrencyEquivalent ?? 0),
        payableCurrency:
          acc.payableCurrency + Number(row.adCash?.payableCurrency ?? 0),
      }),
      { totalBalanceCurrency: 0, payableCurrency: 0 },
    );
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
      stores: enrichedStores,
      totalDue: applied.outstandingDue,
      adCash: {
        totalBalanceCurrency: Number(
          adCashTotals.totalBalanceCurrency.toFixed(2),
        ),
        payableCurrency: Number(adCashTotals.payableCurrency.toFixed(2)),
      },
    };
  }

  /** Vendeur : imputer l'Ad Cash disponible sur la dette crédit Ads. */
  async payMyAdCreditWithAdCash(
    user: UserModel,
    storeId?: string,
  ): Promise<{
    redeemedCurrency: number;
    summary: AdCreditSummaryPayload;
  }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const trimmedStoreId = storeId?.trim();
    if (trimmedStoreId) {
      if (!Types.ObjectId.isValid(trimmedStoreId)) {
        throw new BadRequestException('invalid_store_id');
      }
      await this._storeAccess.assertStoreAccess(
        user,
        trimmedStoreId,
        'campaigns.view',
      );
    }

    await this.reconcileAdCreditBilling(user);
    const access = await this._storeAccess.resolveStoreAccess(user);
    const targetStoreIds = (
      trimmedStoreId
        ? [trimmedStoreId]
        : access
            .filter((a) => Types.ObjectId.isValid(a.storeId))
            .map((a) => a.storeId)
    ).filter((id, idx, arr) => arr.indexOf(id) === idx);

    if (trimmedStoreId && !targetStoreIds.length) {
      throw new NotFoundException('store_not_found');
    }

    const redeemedBefore = (
      await Promise.all(
        targetStoreIds.map((id) => this._storeAdCashRedeemedCurrency(id)),
      )
    ).reduce((acc, v) => acc + v, 0);

    const grossRows = await Promise.all(
      targetStoreIds.map(async (id) => {
        const grossDue = await this._computeSingleStoreGrossAdDue(id);
        const accessRow = access.find((a) => a.storeId === id);
        return {
          storeId: id,
          storeName: accessRow?.storeName || id,
          banners: {
            impressions: 0,
            clicks: 0,
            conversions: 0,
            due: 0,
          },
          campaigns: {
            impressions: 0,
            clicks: 0,
            actionClicks: 0,
            conversions: 0,
            due: 0,
          },
          totalDue: grossDue,
        };
      }),
    );

    await this._reconcileStoreAdCashForStores(grossRows);

    const redeemedAfter = (
      await Promise.all(
        targetStoreIds.map((id) => this._storeAdCashRedeemedCurrency(id)),
      )
    ).reduce((acc, v) => acc + v, 0);

    const summary = await this.getMyAdCredit(user);
    const redeemedCurrency = Number(
      Math.max(0, redeemedAfter - redeemedBefore).toFixed(2),
    );

    if (redeemedCurrency <= 0) {
      const hasBalance = summary.stores.some(
        (s) => (s.adCash?.balanceCurrencyEquivalent ?? 0) > 0,
      );
      if (!hasBalance) {
        throw new BadRequestException('ad_cash_balance_empty');
      }
      if (summary.totalDue <= 0) {
        throw new BadRequestException('ad_credit_already_settled');
      }
      throw new BadRequestException('ad_cash_settlement_unavailable');
    }

    return { redeemedCurrency, summary };
  }

  private async _computeSingleStoreGrossAdDue(storeId: string): Promise<number> {
    if (!Types.ObjectId.isValid(storeId)) return 0;
    await this._autoArchiveExpiredCampaigns();
    await this._autoArchiveExpiredAds();
    const storeOid = new Types.ObjectId(storeId);
    const pricing = this._toPricingPayload(await this._ensurePricingDoc());

    const [bannerDocs, campaignDocs] = await Promise.all([
      this.adModel
        .find({ store: storeOid })
        .select('_id archivedAt billingFinalAmountCad')
        .lean()
        .exec(),
      this._adCampaignModel
        .find({ store: storeOid })
        .select('_id archivedAt billingFinalAmountCad')
        .lean()
        .exec(),
    ]);

    let total = 0;
    for (const doc of bannerDocs as Array<Record<string, unknown>>) {
      if (this._archivedAtFromLean(doc) == null) continue;
      const metrics = { impressions: 0, clicks: 0, conversions: 0 };
      total += Number(
        this._billingFinalAmountFromLean(doc) ||
          this._adBillingAmount(pricing, metrics),
      );
    }
    for (const doc of campaignDocs as Array<Record<string, unknown>>) {
      if (this._archivedAtFromLean(doc) == null) continue;
      const metrics = {
        impressions: 0,
        clicks: 0,
        actionClicks: 0,
        conversions: 0,
      };
      total += Number(
        this._billingFinalAmountFromLean(doc) ||
          this._campaignBillingAmount(pricing, metrics),
      );
    }
    return Number(total.toFixed(2));
  }

  /** Admin : dette crédit Ads et montants en attente par boutique. */
  async getAdminStoreAdSpending(
    user: UserModel,
  ): Promise<AdminStoreAdSpendingPayload> {
    this.assertAdmin(user);
    await this._autoArchiveExpiredCampaigns();
    await this._autoArchiveExpiredAds();

    const ownerIds = await this._storeModel.distinct('owner', {
      owner: { $exists: true, $ne: null },
    });
    const validOwnerIds = ownerIds
      .map((id) => String(id))
      .filter((id) => Types.ObjectId.isValid(id));
    if (!validOwnerIds.length) {
      return {
        currency: 'CAD',
        items: [],
        totals: {
          bannersPendingCad: 0,
          campaignsPendingCad: 0,
          adCreditDebtCad: 0,
          adCashBalanceUnits: 0,
          adCashTotalReceivedUnits: 0,
          adCashUsedUnits: 0,
          adCashBalanceCurrencyEquivalent: 0,
          adCashTotalReceivedCurrencyEquivalent: 0,
          adCashUsedCurrencyEquivalent: 0,
        },
      };
    }

    const vendorDocs = await this._userModel
      .find({
        _id: { $in: validOwnerIds.map((id) => new Types.ObjectId(id)) },
        type: UserTypeEnum.VENDOR,
      })
      .select('_id fullName email type')
      .lean()
      .exec();

    const items: Omit<AdminStoreAdSpendingRow, 'adCash'>[] = [];
    await Promise.all(
      vendorDocs.map(async (doc) => {
        const vendor = doc as unknown as UserModel;
        try {
          const credit = await this.getMyAdCredit(vendor);
          const ownerId = String(vendor._id ?? '');
          const ownerName = String(vendor.fullName ?? vendor.email ?? 'Vendeur');
          const ownerEmail =
            typeof vendor.email === 'string' && vendor.email.trim()
              ? vendor.email.trim()
              : null;
          for (const store of credit.stores) {
            items.push({
              storeId: store.storeId,
              storeName: store.storeName,
              ownerId,
              ownerName,
              ownerEmail,
              currency: credit.currency,
              bannersPendingCad: Number(store.banners.due ?? 0),
              campaignsPendingCad: Number(store.campaigns.due ?? 0),
              adCreditDebtCad: Number(store.totalDue ?? 0),
            });
          }
        } catch {
          /* vendeur sans accès boutique */
        }
      }),
    );

    items.sort((a, b) => b.adCreditDebtCad - a.adCreditDebtCad);
    const currency = items[0]?.currency ?? 'CAD';

    const adCashByStore = await this._bulkStoreAdCashStats(
      items.map((row) => row.storeId),
    );
    const enrichedItems = items.map((row) => ({
      ...row,
      adCash: adCashByStore.get(row.storeId) ?? this.emptyAdCashStats(),
    }));

    const totals = enrichedItems.reduce(
      (acc, row) => ({
        bannersPendingCad: acc.bannersPendingCad + row.bannersPendingCad,
        campaignsPendingCad: acc.campaignsPendingCad + row.campaignsPendingCad,
        adCreditDebtCad: acc.adCreditDebtCad + row.adCreditDebtCad,
        adCashBalanceUnits: acc.adCashBalanceUnits + row.adCash.balanceUnits,
        adCashTotalReceivedUnits:
          acc.adCashTotalReceivedUnits + row.adCash.totalReceivedUnits,
        adCashUsedUnits: acc.adCashUsedUnits + row.adCash.usedUnits,
        adCashBalanceCurrencyEquivalent:
          acc.adCashBalanceCurrencyEquivalent +
          row.adCash.balanceCurrencyEquivalent,
        adCashTotalReceivedCurrencyEquivalent:
          acc.adCashTotalReceivedCurrencyEquivalent +
          row.adCash.totalReceivedCurrencyEquivalent,
        adCashUsedCurrencyEquivalent:
          acc.adCashUsedCurrencyEquivalent + row.adCash.usedCurrencyEquivalent,
      }),
      {
        bannersPendingCad: 0,
        campaignsPendingCad: 0,
        adCreditDebtCad: 0,
        adCashBalanceUnits: 0,
        adCashTotalReceivedUnits: 0,
        adCashUsedUnits: 0,
        adCashBalanceCurrencyEquivalent: 0,
        adCashTotalReceivedCurrencyEquivalent: 0,
        adCashUsedCurrencyEquivalent: 0,
      },
    );

    return {
      currency,
      items: enrichedItems,
      totals: {
        bannersPendingCad: Number(totals.bannersPendingCad.toFixed(2)),
        campaignsPendingCad: Number(totals.campaignsPendingCad.toFixed(2)),
        adCreditDebtCad: Number(totals.adCreditDebtCad.toFixed(2)),
        adCashBalanceUnits: Number(totals.adCashBalanceUnits.toFixed(4)),
        adCashTotalReceivedUnits: Number(
          totals.adCashTotalReceivedUnits.toFixed(4),
        ),
        adCashUsedUnits: Number(totals.adCashUsedUnits.toFixed(4)),
        adCashBalanceCurrencyEquivalent: Number(
          totals.adCashBalanceCurrencyEquivalent.toFixed(2),
        ),
        adCashTotalReceivedCurrencyEquivalent: Number(
          totals.adCashTotalReceivedCurrencyEquivalent.toFixed(2),
        ),
        adCashUsedCurrencyEquivalent: Number(
          totals.adCashUsedCurrencyEquivalent.toFixed(2),
        ),
      },
    };
  }

  async listMyAdCreditPayments(
    user: UserModel,
    opts?: { limit?: number },
  ): Promise<{ items: AdCreditPaymentHistoryRow[] }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const requested = Number(opts?.limit ?? 50);
    const limit = Number.isFinite(requested)
      ? Math.min(200, Math.max(1, Math.floor(requested)))
      : 50;
    const ownerId = new Types.ObjectId(String(user._id));
    const docs = await this._adCreditPaymentModel
      .find({
        owner: ownerId,
        status: AdCreditPaymentStatusEnum.PAID,
      })
      .sort({ paidAt: -1, createdAt: -1 })
      .limit(limit)
      .select(
        '_id amountPaidCad currency status stripeCheckoutSessionId stripePaymentIntentId paidAt createdAt updatedAt',
      )
      .lean()
      .exec();

    const toIsoOrNull = (value: unknown): string | null => {
      if (value == null) return null;
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        !(value instanceof Date)
      ) {
        return null;
      }
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };

    const items = (docs as Array<Record<string, unknown>>).map((doc) => ({
      id: String(doc._id ?? ''),
      amountPaidCad: Number(doc.amountPaidCad ?? 0),
      currency: String(doc.currency ?? 'CAD').toUpperCase(),
      status: String(
        doc.status ?? AdCreditPaymentStatusEnum.PAID,
      ).toUpperCase() as AdCreditPaymentStatusEnum,
      stripeCheckoutSessionId: String(doc.stripeCheckoutSessionId ?? ''),
      stripePaymentIntentId:
        doc.stripePaymentIntentId != null
          ? String(doc.stripePaymentIntentId)
          : null,
      paidAt:
        toIsoOrNull(doc.paidAt) ??
        toIsoOrNull(doc.createdAt) ??
        new Date().toISOString(),
      createdAt: toIsoOrNull(doc.createdAt),
      updatedAt: toIsoOrNull(doc.updatedAt),
    }));

    return { items };
  }

  /**
   * Recalcule et finalise la facturation de toutes les bannières / campagnes archivées
   * dont `billingFinalizedAt` est absent. Idempotent : ne touche pas ce qui est déjà figé.
   * - Vendeur : uniquement ses boutiques.
   * - Admin : fournir `targetOwnerId` pour cibler un vendeur, null = toutes les boutiques.
   */
  async reconcileAdCreditBilling(
    user: UserModel,
    opts?: { targetOwnerId?: string },
  ): Promise<{
    bannersReconciled: number;
    campaignsReconciled: number;
    totalBillableCad: number;
  }> {
    const isAdmin = user.type === UserTypeEnum.ADMIN;
    if (!isAdmin && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }

    let storeIds: Types.ObjectId[];

    if (isAdmin && opts?.targetOwnerId) {
      if (!Types.ObjectId.isValid(opts.targetOwnerId)) {
        throw new BadRequestException('invalid_owner_id');
      }
      const ownerUser = await this._userModel
        ?.findById(opts.targetOwnerId)
        .select('_id')
        .lean()
        .exec();
      if (!ownerUser) throw new NotFoundException('owner_not_found');
      const access = await this._storeAccess.resolveStoreAccess(
        ownerUser as unknown as UserModel,
      );
      storeIds = access
        .filter((a) => Types.ObjectId.isValid(a.storeId))
        .map((a) => new Types.ObjectId(a.storeId));
    } else if (isAdmin && !opts?.targetOwnerId) {
      // Toutes les boutiques
      storeIds = [];
    } else {
      const access = await this._storeAccess.resolveStoreAccess(user);
      storeIds = access
        .filter((a) => Types.ObjectId.isValid(a.storeId))
        .map((a) => new Types.ObjectId(a.storeId));
    }

    const storeFilter =
      storeIds.length > 0 ? { store: { $in: storeIds } } : {};
    const archivedFilter = {
      $or: [
        { archivedAt: { $exists: true, $ne: null } },
      ],
      $and: [
        {
          $or: [
            { billingFinalizedAt: { $exists: false } },
            { billingFinalizedAt: null },
          ],
        },
      ],
    };

    const [pendingBanners, pendingCampaigns] = await Promise.all([
      this.adModel
        .find({ ...storeFilter, ...archivedFilter })
        .select('_id')
        .lean()
        .exec(),
      this._adCampaignModel
        .find({ ...storeFilter, ...archivedFilter })
        .select('_id')
        .lean()
        .exec(),
    ]);

    let bannersReconciled = 0;
    let campaignsReconciled = 0;
    let totalBillableCad = 0;

    for (const doc of pendingBanners as Array<Record<string, unknown>>) {
      const oid = new Types.ObjectId(String(doc._id));
      await this._finalizeAdBilling(oid);
      bannersReconciled++;
    }
    for (const doc of pendingCampaigns as Array<Record<string, unknown>>) {
      const oid = new Types.ObjectId(String(doc._id));
      await this._finalizeCampaignBilling(oid);
      campaignsReconciled++;
    }

    // Somme des montants recalculés
    if (bannersReconciled + campaignsReconciled > 0) {
      const [bannerSum, campaignSum] = await Promise.all([
        pendingBanners.length
          ? this.adModel
              .aggregate<{ _id: null; total: number }>([
                {
                  $match: {
                    _id: {
                      $in: (pendingBanners as Array<Record<string, unknown>>).map(
                        (d) => new Types.ObjectId(String(d._id)),
                      ),
                    },
                  },
                },
                { $group: { _id: null, total: { $sum: '$billingFinalAmountCad' } } },
              ])
              .exec()
          : Promise.resolve([]),
        pendingCampaigns.length
          ? this._adCampaignModel
              .aggregate<{ _id: null; total: number }>([
                {
                  $match: {
                    _id: {
                      $in: (
                        pendingCampaigns as Array<Record<string, unknown>>
                      ).map((d) => new Types.ObjectId(String(d._id))),
                    },
                  },
                },
                { $group: { _id: null, total: { $sum: '$billingFinalAmountCad' } } },
              ])
              .exec()
          : Promise.resolve([]),
      ]);
      totalBillableCad = Number(
        (
          Number((bannerSum as Array<{ total: number }>)[0]?.total ?? 0) +
          Number((campaignSum as Array<{ total: number }>)[0]?.total ?? 0)
        ).toFixed(2),
      );
    }

    return { bannersReconciled, campaignsReconciled, totalBillableCad };
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
              name: 'Wise Eat · Règlement crédit Ads',
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
        description: 'Wise Eat · Paiement crédit Ads',
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
    const amountPaidCad = Number(
      ((session.amount_total ?? 0) / 100).toFixed(2),
    );
    if (!Number.isFinite(amountPaidCad) || amountPaidCad <= 0) {
      throw new BadRequestException('ad_credit_checkout_invalid_amount');
    }
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    const ownerOid = new Types.ObjectId(String(user._id));
    await this._adCreditPaymentModel
      .updateOne(
        { stripeCheckoutSessionId: sid },
        {
          $set: {
            owner: ownerOid,
            amountPaidCad,
            currency: 'CAD',
            status: AdCreditPaymentStatusEnum.PAID,
            stripePaymentIntentId: paymentIntentId,
            paidAt: new Date(),
          },
          $setOnInsert: {
            stripeCheckoutSessionId: sid,
          },
        },
        { upsert: true },
      )
      .exec();
    await this._syncAdCreditPaymentsFromStripe(ownerOid);
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
    const resolved =
      (await this._mediasService.resolvePublicMediaUrl(url)) ?? url;
    return { url: resolved };
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
    const max = await this._mediasService.getMaxFileSizeBytes();
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
    const resolved =
      (await this._mediasService.resolvePublicMediaUrl(url)) ?? url;
    return { url: resolved };
  }

  private async enrichAdManagementRow(
    row: AdManagementRow,
  ): Promise<AdManagementRow> {
    const raw = row.imageUrl;
    const imageUrl = raw
      ? ((await this._mediasService.resolvePublicMediaUrl(raw)) ?? raw)
      : null;
    return {
      ...row,
      imageUrl,
      imageStorageEngine: detectCatalogImageStorageKind(imageUrl ?? raw),
    };
  }

  private async toManagementRowResolved(
    doc: Record<string, unknown>,
  ): Promise<AdManagementRow> {
    return this.enrichAdManagementRow(this.toManagementRow(doc));
  }

  private async resolvePublicAdImageUrls(docs: AdModel[]): Promise<AdModel[]> {
    const out: AdModel[] = [];
    for (const doc of docs) {
      const raw = doc.imageUrl?.trim();
      if (!raw) {
        out.push(doc);
        continue;
      }
      const resolved =
        (await this._mediasService.resolvePublicMediaUrl(raw)) ?? raw;
      if (resolved === raw) {
        out.push(doc);
        continue;
      }
      doc.imageUrl = resolved;
      out.push(doc);
    }
    return out;
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
    const listingRaw =
      doc.marketingOfferListing ?? doc.marketing_offer_listing;
    let marketingOfferListingId: string | null = null;
    let marketingOfferListingLabel: string | null = null;
    if (
      listingRaw != null &&
      typeof listingRaw === 'object' &&
      '_id' in (listingRaw as object)
    ) {
      const listing = listingRaw as Record<string, unknown>;
      marketingOfferListingId = String(listing._id ?? '');
      const product = listing.productId as Record<string, unknown> | null;
      const offer = listing.marketingOfferId as Record<string, unknown> | null;
      const strategyName = offer?.name ? String(offer.name) : '';
      const productTitle = product?.title ? String(product.title) : '';
      marketingOfferListingLabel =
        strategyName && productTitle
          ? `${strategyName} — ${productTitle}`
          : productTitle || strategyName || null;
    } else if (listingRaw instanceof Types.ObjectId) {
      marketingOfferListingId = listingRaw.toString();
    } else if (typeof listingRaw === 'string' && listingRaw) {
      marketingOfferListingId = listingRaw;
    }
    // Bundle bannière : ref peuplée `{ _id, nameFr, nameEn }` ou ObjectId plat.
    const bundleRaw = doc.productBundle ?? doc.product_bundle;
    let productBundleId: string | null = null;
    let productBundleLabel: string | null = null;
    if (
      bundleRaw != null &&
      typeof bundleRaw === 'object' &&
      '_id' in (bundleRaw as object)
    ) {
      const b = bundleRaw as Record<string, unknown>;
      productBundleId = String(b._id ?? '');
      const nameFr = String(b.nameFr ?? '').trim();
      const nameEn = String(b.nameEn ?? '').trim();
      productBundleLabel = nameFr || nameEn || null;
    } else if (bundleRaw instanceof Types.ObjectId) {
      productBundleId = bundleRaw.toString();
    } else if (typeof bundleRaw === 'string' && bundleRaw) {
      productBundleId = bundleRaw;
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
    const imageUrl = doc.imageUrl != null ? String(doc.imageUrl) : null;
    return {
      id,
      storeId,
      storeName,
      region: normalizeAdRegionScope(
        doc.region != null ? String(doc.region) : null,
      ),
      title: String(doc.title ?? ''),
      subtitle: String(doc.subtitle ?? ''),
      actionText: String(doc.actionText ?? ''),
      imageUrl,
      imageStorageEngine: detectCatalogImageStorageKind(imageUrl),
      sortOrder: Number(doc.sortOrder ?? 0),
      isActive: Boolean(doc.isActive),
      validFrom: validFromIso,
      validUntil: validUntilIso,
      actionType: at,
      actionTarget: actTarget,
      productId,
      productTitle,
      marketingOfferListingId,
      marketingOfferListingLabel,
      productBundleId,
      productBundleLabel,
      archivedAt:
        doc.archivedAt instanceof Date
          ? doc.archivedAt.toISOString()
          : doc.archivedAt != null
          ? String(doc.archivedAt)
          : null,
      archiveReason:
        doc.archiveReason != null && String(doc.archiveReason).trim() !== ''
          ? (String(doc.archiveReason)
              .trim()
              .toUpperCase() as AdArchiveReasonEnum)
          : null,
      billingFinalizedAt:
        doc.billingFinalizedAt instanceof Date
          ? doc.billingFinalizedAt.toISOString()
          : doc.billingFinalizedAt != null
          ? String(doc.billingFinalizedAt)
          : null,
      billingFinalAmountCad: Number(doc.billingFinalAmountCad ?? 0),
      audienceTotal: audienceTotalFromDoc(doc),
      notificationAddon: notificationAddonFromDoc(
        (doc.notificationAddon ?? doc.notification_addon) as
          | Record<string, unknown>
          | undefined,
      ),
      ...this.moderationFieldsForRow(doc),
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

  private async _sortPublicAdsByStorePlanScore(ads: AdModel[]): Promise<AdModel[]> {
    const storeIds = [
      ...new Set(
        ads
          .map((d) => this._storeIdFromAdDoc(d as unknown as Record<string, unknown>))
          .filter((id): id is Types.ObjectId => id != null)
          .map((id) => id.toString()),
      ),
    ];
    if (!storeIds.length) return ads;

    const [planScoreByStore, weights] = await Promise.all([
      this._subscriptions.resolveActivePlanScoreByStoreIds(storeIds),
      this._searchSettings.getRecommendationWeights(),
    ]);
    const weight = weights.vendorPlanScore;
    if (weight <= 0) return ads;

    const scoreForAd = (d: AdModel): number => {
      const storeOid = this._storeIdFromAdDoc(d as unknown as Record<string, unknown>);
      if (storeOid == null) return 0;
      const planScore = planScoreByStore.get(storeOid.toString()) ?? 0;
      return (Math.max(0, planScore) / 100) * weight;
    };

    return [...ads].sort((a, b) => {
      const diff = scoreForAd(b) - scoreForAd(a);
      if (diff !== 0) return diff;
      return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
    });
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
  async listPublic(clientRegion?: string): Promise<AdModel[]> {
    const filterRegion = normalizeCountryCode(clientRegion ?? '') || undefined;
    const cacheRegion = filterRegion ?? 'ALL';
    return this._cacheLayer.getOrSet(
      'publicCatalog',
      AppCacheKeys.adsPublic(cacheRegion),
      apiPublicCacheTtlMs(),
      () => this._loadListPublic(filterRegion),
    );
  }

  private async _storeRegionsById(
    storeIds: string[],
  ): Promise<Map<string, string>> {
    const oids = storeIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!oids.length) return new Map();
    const rows = await this._storeModel
      .find({ _id: { $in: oids } })
      .select('region address')
      .populate({ path: 'address', select: 'countryCode' })
      .lean()
      .exec();
    const out = new Map<string, string>();
    for (const row of rows) {
      let code = normalizeCountryCode(
        (row as { region?: string }).region,
      );
      if (!code) {
        const addr = (row as { address?: { countryCode?: string } | null })
          .address;
        code = normalizeCountryCode(addr?.countryCode);
      }
      if (code) {
        out.set(String(row._id), code);
      }
    }
    return out;
  }

  private _matchesClientRegion(
    clientRegion: string | undefined,
    entityRegion?: string | null,
  ): boolean {
    return adRegionMatchesClient(clientRegion, entityRegion);
  }

  private async _resolveStoreRegionCode(storeId: string): Promise<string> {
    const map = await this._storeRegionsById([storeId]);
    return map.get(storeId) ?? '';
  }

  private async _resolveAdRegionForWrite(
    user: UserModel,
    storeOid: Types.ObjectId | undefined,
    dtoRegion?: string | null,
  ): Promise<string> {
    if (storeOid) {
      const fromStore = await this._resolveStoreRegionCode(storeOid.toString());
      if (!fromStore) {
        throw new BadRequestException('store_region_required');
      }
      return fromStore;
    }
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }
    if (isAdRegionAll(dtoRegion)) {
      return AD_REGION_ALL;
    }
    const code = normalizeCountryCode(dtoRegion ?? '');
    if (!code) {
      throw new BadRequestException('region_required_for_global_ad');
    }
    if (!(await this._supportedCountries.isActiveCode(code))) {
      throw new BadRequestException('region_not_active');
    }
    return code;
  }

  private async _loadListPublic(filterRegion?: string): Promise<AdModel[]> {
    await this._autoArchiveExpiredAds();
    const raw = await this.adModel
      .find({
        isActive: true,
        ...this.approvedForPublicModerationFilter(),
      })
      .populate('store', 'name profileImage status')
      .populate('product', 'title')
      // Expose les refs pour deep-link mobile (offre exclusive / bundle).
      .populate('marketingOfferListing', '_id')
      .populate('productBundle', '_id nameFr nameEn')
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
    const paymentsReadyStoreIds = filterRegion
      ? await resolveStoreIdsVisibleOnMobileApp(
          this._storeModel,
          shopStoreIds,
        )
      : null;
    const regionByStoreId = filterRegion
      ? await this._storeRegionsById([...(paymentsReadyStoreIds ?? [])])
      : new Map<string, string>();
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
      if (storeOid == null) {
        const adRegion = String(d.region ?? '').trim();
        return !filterRegion || this._matchesClientRegion(filterRegion, adRegion);
      }
      if (!filterRegion) {
        const storePop = d.store as { status?: string } | null | undefined;
        return storePop?.status === StoreStatusEnum.ACTIVE;
      }
      if (!paymentsReadyStoreIds?.has(storeOid.toString())) return false;
      const storeRegion = regionByStoreId.get(storeOid.toString());
      if (!storeRegion) return false;
      return this._matchesClientRegion(filterRegion, storeRegion);
    }) as unknown as AdModel[];
    const withMedia = await this.resolvePublicAdImageUrls(data);
    const planSorted = await this._sortPublicAdsByStorePlanScore(withMedia);
    return this.orderPublicAdsByMinTwoThirdsShop(planSorted);
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
        .populate('productBundle', 'nameFr nameEn')
        .populate({
          path: 'marketingOfferListing',
          populate: [
            { path: 'productId', select: 'title' },
            { path: 'marketingOfferId', select: 'name' },
          ],
        })
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean()
        .exec();
      return Promise.all(
        docs.map((d) =>
          this.toManagementRowResolved(d as Record<string, unknown>),
        ),
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
      .populate('productBundle', 'nameFr nameEn')
      .populate({
        path: 'marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title' },
          { path: 'marketingOfferId', select: 'name' },
        ],
      })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean()
      .exec();
    return Promise.all(
      docs.map((d) =>
        this.toManagementRowResolved(d as Record<string, unknown>),
      ),
    );
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

  /** Vérifie qu’un bundle actif appartient à la boutique de la bannière. */
  private async assertProductBundleBelongsToStore(
    productBundleId: string,
    storeId: string,
  ): Promise<void> {
    const n = await this._productBundleModel
      .countDocuments({
        _id: new Types.ObjectId(productBundleId),
        storeId: new Types.ObjectId(storeId),
      })
      .exec();
    if (!n) {
      throw new BadRequestException('product_bundle_not_in_store');
    }
  }

  private async assertExclusiveOfferListingsBelongToStore(
    storeId: string,
    listingIds: Array<string | Types.ObjectId>,
  ): Promise<void> {
    const oids = listingIds
      .map((id) => (id instanceof Types.ObjectId ? id : String(id).trim()))
      .filter((id) => Types.ObjectId.isValid(String(id)))
      .map((id) =>
        id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id)),
      );
    if (!oids.length) {
      throw new BadRequestException('exclusive_offer_listing_required');
    }
    const rows = await this._marketingOfferListingModel
      .find({
        _id: { $in: oids },
        storeId: new Types.ObjectId(storeId),
        status: MarketingOfferListingStatusEnum.ACTIVE,
      })
      .select('_id marketingOfferId marketingOfferType')
      .lean()
      .exec();
    if (rows.length !== oids.length) {
      throw new BadRequestException('exclusive_offer_listing_not_in_store');
    }
    const offerIds = [
      ...new Set(rows.map((r) => String(r.marketingOfferId ?? ''))),
    ].filter((id) => Types.ObjectId.isValid(id));
    if (!offerIds.length) {
      throw new BadRequestException('exclusive_offer_listing_invalid');
    }
    const offers = await this._marketingOfferModel
      .find({ _id: { $in: offerIds.map((id) => new Types.ObjectId(id)) } })
      .select('_id type moderationStatus')
      .lean()
      .exec();
    const offerById = new Map(offers.map((o) => [String(o._id), o]));
    for (const row of rows) {
      const offer = offerById.get(String(row.marketingOfferId ?? ''));
      if (!offer) {
        throw new BadRequestException('exclusive_offer_listing_invalid');
      }
      if (offer.moderationStatus === MarketingOfferModerationStatusEnum.BLOCKED) {
        throw new BadRequestException('marketing_offer_blocked');
      }
      if (!isDirectCheckoutStrategyType(String(row.marketingOfferType ?? ''))) {
        throw new BadRequestException('marketing_offer_not_direct_checkout');
      }
    }
  }

  private _campaignItemsToDb(items: CampaignItemDto[]) {
    return this._normalizeCampaignItems(items).map((it) => ({
      itemType: it.itemType,
      product:
        it.itemType === AdCampaignItemTypeEnum.PRODUCT && it.productId
          ? (new Types.ObjectId(it.productId) as unknown as ProductModel)
          : undefined,
      drink:
        it.itemType === AdCampaignItemTypeEnum.DRINK && it.drinkId
          ? (new Types.ObjectId(it.drinkId) as unknown as DrinkModel)
          : undefined,
      marketingOfferListing:
        it.itemType === AdCampaignItemTypeEnum.EXCLUSIVE_OFFER &&
        it.marketingOfferListingId
          ? (new Types.ObjectId(
              it.marketingOfferListingId,
            ) as unknown as import('@schemas/marketing-offer-listing.schema').MarketingOfferListingModel)
          : undefined,
      productBundle:
        it.itemType === AdCampaignItemTypeEnum.BUNDLE && it.productBundleId
          ? (new Types.ObjectId(
              it.productBundleId,
            ) as unknown as ProductBundleModel)
          : undefined,
    }));
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
    if (!storeOid && dto.actionType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER) {
      throw new BadRequestException('global_exclusive_offer_action_forbidden');
    }

    if (storeOid) {
      await this.assertUserCanManageStore(user, storeOid.toString());
      if (user.type === UserTypeEnum.VENDOR) {
        await this._subscriptions.assertMarketingToolsEnabledForStore(
          storeOid.toString(),
          user,
        );
      }
    }

    const requiresModeration = this.vendorRequiresModeration(
      user,
      storeOid?.toString(),
    );
    const moderationStatus = requiresModeration
      ? AdModerationStatusEnum.PENDING_REVIEW
      : AdModerationStatusEnum.APPROVED;
    const isActive = requiresModeration ? false : dto.isActive !== false;

    if (storeOid && isActive) {
      await this.assertActiveBannerLimit(storeOid.toString(), user);
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
    if (dto.actionType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER) {
      if (!dto.marketingOfferListingId || !storeOid) {
        throw new BadRequestException('exclusive_offer_listing_required');
      }
      await this.assertExclusiveOfferListingsBelongToStore(
        storeOid.toString(),
        [dto.marketingOfferListingId],
      );
    }
    if (dto.actionType === StoreAdActionTypeEnum.BUNDLE) {
      if (!dto.productBundleId || !storeOid) {
        throw new BadRequestException('product_bundle_required_for_action');
      }
      await this.assertProductBundleBelongsToStore(
        dto.productBundleId,
        storeOid.toString(),
      );
    }

    const linkTarget = isAdLinkActionType(dto.actionType)
      ? this.assertActionTargetValue(dto.actionType, dto.actionTarget)
      : undefined;

    const regionCode = await this._resolveAdRegionForWrite(
      user,
      storeOid,
      dto.region,
    );

    const channelAvailability = await this._getAvailableNotificationChannels();
    const created = await this.adModel.create({
      isActive,
      moderationStatus,
      title: dto.title.trim(),
      subtitle: dto.subtitle.trim(),
      actionText: dto.actionText.trim(),
      imageUrl: dto.imageUrl?.trim() || undefined,
      sortOrder: dto.sortOrder ?? 0,
      store: storeOid,
      region: regionCode,
      validFrom,
      validUntil,
      actionType: dto.actionType,
      actionTarget: linkTarget || undefined,
      product:
        dto.actionType === StoreAdActionTypeEnum.PRODUCT && dto.productId
          ? productRefId(dto.productId)
          : undefined,
      marketingOfferListing:
        dto.actionType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER &&
        dto.marketingOfferListingId
          ? exclusiveOfferListingRefId(dto.marketingOfferListingId)
          : undefined,
      productBundle:
        dto.actionType === StoreAdActionTypeEnum.BUNDLE && dto.productBundleId
          ? productBundleRefId(dto.productBundleId)
          : undefined,
      audienceTotal: normalizeAudienceTotal(dto.audienceTotal) ?? null,
      notificationAddon: normalizeNotificationAddonInput(
        dto.notificationAddon,
        channelAvailability,
      ),
    });

    this.invalidateListCache();
    if (moderationStatus === AdModerationStatusEnum.APPROVED) {
      this.scheduleNotificationDispatchAfterSave(
        'banner',
        created._id,
        created.notificationAddon,
      );
    }

    const populated = await this.adModel
      .findById(created._id)
      .populate('store', 'name')
      .populate('product', 'title')
      .populate('productBundle', 'nameFr nameEn')
      .populate({
        path: 'marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title' },
          { path: 'marketingOfferId', select: 'name' },
        ],
      })
      .lean()
      .exec();
    return this.toManagementRowResolved(populated as Record<string, unknown>);
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
      if (user.type === UserTypeEnum.VENDOR) {
        await this._subscriptions.assertMarketingToolsEnabledForStore(
          storeIdStr,
          user,
        );
      }
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }

    if (user.type === UserTypeEnum.VENDOR) {
      this.assertVendorAdNotBlocked(user, existing.moderationStatus);
      if (
        dto.isActive === true &&
        existing.moderationStatus !== AdModerationStatusEnum.APPROVED
      ) {
        throw new ForbiddenException('ad_moderation_required');
      }
      if (existing.moderationStatus === AdModerationStatusEnum.REJECTED) {
        existing.moderationStatus = AdModerationStatusEnum.PENDING_REVIEW;
        existing.rejectionReason = undefined;
        existing.reviewedAt = null;
        existing.reviewedBy = null;
        existing.isActive = false;
      }
    }

    const nextAction =
      dto.actionType ?? existing.actionType ?? StoreAdActionTypeEnum.SHOP;
    if (!storeIdStr && nextAction === StoreAdActionTypeEnum.PRODUCT) {
      throw new BadRequestException('global_product_action_forbidden');
    }
    if (!storeIdStr && nextAction === StoreAdActionTypeEnum.EXCLUSIVE_OFFER) {
      throw new BadRequestException('global_exclusive_offer_action_forbidden');
    }

    // Enforce banner limit when activating a previously inactive banner
    if (
      dto.isActive === true &&
      !existing.isActive &&
      storeIdStr &&
      existing.moderationStatus === AdModerationStatusEnum.APPROVED
    ) {
      await this.assertActiveBannerLimit(storeIdStr, user);
    }

    const previousBannerStatus = VendorStatusEmailService.resolveBannerStatus({
      isActive: Boolean(existing.isActive),
      validFrom: existing.validFrom,
      validUntil: existing.validUntil,
      archivedAt: existing.archivedAt,
      archiveReason: existing.archiveReason,
    });

    // Début/fin verrouillés si le couple était déjà complet.
    if (dto.validFrom != null || dto.validUntil != null) {
      const hadBothDates = Boolean(existing.validFrom && existing.validUntil);
      if (hadBothDates && dto.validFrom != null) {
        const existingFrom = new Date(existing.validFrom as Date).getTime();
        const proposedFrom = new Date(dto.validFrom).getTime();
        if (
          !Number.isNaN(existingFrom) &&
          !Number.isNaN(proposedFrom) &&
          existingFrom !== proposedFrom
        ) {
          throw new BadRequestException('ad_start_date_locked');
        }
      }
      if (hadBothDates && dto.validUntil != null) {
        const existingUntil = new Date(existing.validUntil as Date).getTime();
        const proposedUntil = new Date(dto.validUntil).getTime();
        if (
          !Number.isNaN(existingUntil) &&
          !Number.isNaN(proposedUntil) &&
          existingUntil !== proposedUntil
        ) {
          throw new BadRequestException('ad_end_date_locked');
        }
      }
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
      // Ne pose les dates que si le couple n’était pas déjà verrouillé.
      if (!hadBothDates) {
        if (dto.validFrom != null) existing.validFrom = nf;
        if (dto.validUntil != null) existing.validUntil = nu;
      }
    }

    if (dto.title != null) existing.title = dto.title.trim();
    if (dto.subtitle != null) existing.subtitle = dto.subtitle.trim();
    if (dto.actionText != null) existing.actionText = dto.actionText.trim();
    if (dto.imageUrl !== undefined) {
      const prev = existing.imageUrl?.trim();
      const next =
        dto.imageUrl === null || dto.imageUrl === ''
          ? undefined
          : dto.imageUrl.trim();
      if (prev?.startsWith('http') && next !== prev) {
        await this._mediasService.delete(prev).catch(() => undefined);
      }
      existing.imageUrl = next;
    }
    if (dto.sortOrder != null) existing.sortOrder = dto.sortOrder;
    if (dto.region !== undefined) {
      if (storeIdStr) {
        throw new BadRequestException('store_ad_region_locked');
      }
      existing.region = await this._resolveAdRegionForWrite(
        user,
        undefined,
        dto.region,
      );
    }
    if (dto.isActive != null) existing.isActive = dto.isActive;
    if (dto.actionType != null) existing.actionType = dto.actionType;

    const effectiveStoreId = storeIdStr;
    if (dto.actionType === StoreAdActionTypeEnum.SHOP) {
      existing.product = undefined;
      existing.marketingOfferListing = undefined;
      existing.productBundle = undefined;
      existing.actionTarget = undefined;
    } else if (dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
      existing.actionTarget = undefined;
      existing.marketingOfferListing = undefined;
      existing.productBundle = undefined;
      const pid = dto.productId;
      if (!pid || !effectiveStoreId) {
        throw new BadRequestException('product_required_for_action');
      }
      await this.assertProductBelongsToStore(pid, effectiveStoreId);
      existing.product = productRefId(pid);
    } else if (dto.actionType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER) {
      existing.actionTarget = undefined;
      existing.product = undefined;
      existing.productBundle = undefined;
      const listingId = dto.marketingOfferListingId;
      if (!listingId || !effectiveStoreId) {
        throw new BadRequestException('exclusive_offer_listing_required');
      }
      await this.assertExclusiveOfferListingsBelongToStore(effectiveStoreId, [
        listingId,
      ]);
      existing.marketingOfferListing = exclusiveOfferListingRefId(listingId);
    } else if (dto.actionType === StoreAdActionTypeEnum.BUNDLE) {
      // Combo : productBundleId obligatoire + boutique (pas de bannière globale).
      existing.actionTarget = undefined;
      existing.product = undefined;
      existing.marketingOfferListing = undefined;
      const bundleId = dto.productBundleId;
      if (!bundleId || !effectiveStoreId) {
        throw new BadRequestException('product_bundle_required_for_action');
      }
      await this.assertProductBundleBelongsToStore(bundleId, effectiveStoreId);
      existing.productBundle = productBundleRefId(bundleId);
    } else if (dto.actionType != null && isAdLinkActionType(dto.actionType)) {
      existing.product = undefined;
      existing.marketingOfferListing = undefined;
      existing.productBundle = undefined;
      if (dto.actionTarget !== undefined) {
        existing.actionTarget =
          dto.actionTarget === null || dto.actionTarget === ''
            ? undefined
            : this.assertActionTargetValue(dto.actionType, dto.actionTarget);
      }
    }

    if (dto.productId === null) {
      existing.product = undefined;
    } else if (dto.marketingOfferListingId === null) {
      existing.marketingOfferListing = undefined;
    } else if (dto.productBundleId === null) {
      existing.productBundle = undefined;
    } else if (
      dto.marketingOfferListingId &&
      !dto.actionType &&
      existing.actionType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER &&
      effectiveStoreId
    ) {
      await this.assertExclusiveOfferListingsBelongToStore(effectiveStoreId, [
        dto.marketingOfferListingId,
      ]);
      existing.marketingOfferListing = exclusiveOfferListingRefId(
        dto.marketingOfferListingId,
      );
    } else if (
      dto.productBundleId &&
      !dto.actionType &&
      existing.actionType === StoreAdActionTypeEnum.BUNDLE &&
      effectiveStoreId
    ) {
      await this.assertProductBundleBelongsToStore(
        dto.productBundleId,
        effectiveStoreId,
      );
      existing.productBundle = productBundleRefId(dto.productBundleId);
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
    } else if (finalType === StoreAdActionTypeEnum.EXCLUSIVE_OFFER) {
      const listingRef = existing.marketingOfferListing;
      const listingId =
        listingRef != null ? String(listingRef) : '';
      if (!listingId || !Types.ObjectId.isValid(listingId) || !effectiveStoreId) {
        throw new BadRequestException('exclusive_offer_listing_required');
      }
      await this.assertExclusiveOfferListingsBelongToStore(effectiveStoreId, [
        listingId,
      ]);
      existing.actionTarget = undefined;
    } else if (finalType === StoreAdActionTypeEnum.BUNDLE) {
      const bundleRef = existing.productBundle;
      const bundleId = bundleRef != null ? String(bundleRef) : '';
      if (!bundleId || !Types.ObjectId.isValid(bundleId) || !effectiveStoreId) {
        throw new BadRequestException('product_bundle_required_for_action');
      }
      await this.assertProductBundleBelongsToStore(bundleId, effectiveStoreId);
      existing.actionTarget = undefined;
    } else {
      existing.actionTarget = undefined;
    }

    if (dto.audienceTotal !== undefined) {
      existing.audienceTotal = normalizeAudienceTotal(dto.audienceTotal) ?? null;
    }
    if (dto.notificationAddon !== undefined) {
      const channelAvailability = await this._getAvailableNotificationChannels();
      existing.notificationAddon = normalizeNotificationAddonInput(
        dto.notificationAddon,
        channelAvailability,
      );
      if (existing.moderationStatus === AdModerationStatusEnum.APPROVED) {
        this.scheduleNotificationDispatchAfterSave(
          'banner',
          existing._id,
          existing.notificationAddon,
        );
      }
    }

    await existing.save();
    this.invalidateListCache();

    if (storeIdStr) {
      const newBannerStatus = VendorStatusEmailService.resolveBannerStatus({
        isActive: Boolean(existing.isActive),
        validFrom: existing.validFrom,
        validUntil: existing.validUntil,
        archivedAt: existing.archivedAt,
        archiveReason: existing.archiveReason,
      });
      this._queueBannerStatusEmail({
        storeId: storeIdStr,
        bannerId: String(existing._id),
        bannerTitle: String(existing.title ?? ''),
        previousStatus: previousBannerStatus,
        newStatus: newBannerStatus,
      });
    }

    const populated = await this.adModel
      .findById(oid)
      .populate('store', 'name')
      .populate('product', 'title')
      .populate('productBundle', 'nameFr nameEn')
      .populate({
        path: 'marketingOfferListing',
        populate: [
          { path: 'productId', select: 'title' },
          { path: 'marketingOfferId', select: 'name' },
        ],
      })
      .lean()
      .exec();
    return this.toManagementRowResolved(populated as Record<string, unknown>);
  }

  async endManagement(
    user: UserModel,
    id: string,
  ): Promise<{ ok: true; adId: string; archivedAt: string }> {
    this.assertVendorOrAdmin(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ad_not_found');
    }
    const existing = await this.adModel
      .findById(id)
      .select('_id store archivedAt billingFinalizedAt moderationStatus')
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
    const adOid = new Types.ObjectId(String(existing._id));
    const lean = existing as unknown as Record<string, unknown>;
    this.assertVendorAdNotBlocked(user, this.moderationStatusFromDoc(lean));
    if (!this._archivedAtFromLean(lean)) {
      await this._archiveAdById(adOid, {
        forceEndsNow: true,
        reason: AdArchiveReasonEnum.ENDED,
      });
      this.invalidateListCache();
    } else if (!this._billingFinalizedFromLean(lean)) {
      await this._finalizeAdBilling(adOid);
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
        String(
          (out as { archivedAt?: Date | string } | null)?.archivedAt ??
            new Date(),
        ),
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
    await this.publishAdEngagement(
      dto.eventType === AdEventTypeEnum.IMPRESSION
        ? 'ad.impression'
        : 'ad.click',
      {
        adId: dto.adId,
        customerUserId: uid ? String(uid) : undefined,
        clientInstallId: install,
        adScope: 'BANNER',
      },
    );
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

    const adDoc = await this.adModel
      .findById(oid)
      .select('notificationAddon')
      .lean()
      .exec();
    const notificationAddon = notificationAddonFromDoc(
      adDoc as Record<string, unknown> | null,
    );

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
      notifications,
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
                  $cond: [
                    { $eq: ['$eventType', AdEventTypeEnum.CONVERSION] },
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
      this._adEventModel
        .find({ ad: oid })
        .sort({ createdAt: -1 })
        .limit(80)
        .populate('user', 'email fullName')
        .lean()
        .exec(),
      this._adNotifications.buildStatsForAd(oid, notificationAddon.enabled),
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
          r.conversionSource != null
            ? (String(r.conversionSource) as AdConversionSourceEnum)
            : null,
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
      notifications,
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
      .populate('items.productBundle', 'nameFr nameEn image')
      .select('store items notificationAddon')
      .lean()
      .exec();
    if (!campaign) {
      throw new NotFoundException('campaign_not_found');
    }

    const campaignNotificationAddon = notificationAddonFromDoc(
      campaign as Record<string, unknown>,
    );

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
      notifications,
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
                  $cond: [
                    { $eq: ['$eventType', AdCampaignEventTypeEnum.CLICK] },
                    1,
                    0,
                  ],
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
                  $cond: [
                    { $eq: ['$eventType', AdCampaignEventTypeEnum.CLICK] },
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
      this._adNotifications.buildStatsForCampaign(
        oid,
        campaignNotificationAddon.enabled,
      ),
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
      const itemType = String(item.itemType ?? '')
        .trim()
        .toUpperCase();
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
      } else if (itemType === AdCampaignItemTypeEnum.EXCLUSIVE_OFFER) {
        const listing = item.marketingOfferListing as
          | Record<string, unknown>
          | undefined
          | null;
        const itemId = listing?._id ? String(listing._id) : '';
        if (!itemId) continue;
        const product = listing?.productId as Record<string, unknown> | null;
        const offer = listing?.marketingOfferId as Record<string, unknown> | null;
        const strategyName = offer?.name ? String(offer.name) : 'Offre exclusive';
        const productTitle = product?.title ? String(product.title) : '';
        const title =
          productTitle.trim().length > 0
            ? `${strategyName} — ${productTitle}`
            : strategyName;
        itemTitles.set(`EXCLUSIVE_OFFER:${itemId}`, title);
      } else if (itemType === AdCampaignItemTypeEnum.BUNDLE) {
        const b = item.productBundle as Record<string, unknown> | undefined | null;
        const itemId = b?._id ? String(b._id) : '';
        if (!itemId) continue;
        const nameFr = String(b?.nameFr ?? '').trim();
        const nameEn = String(b?.nameEn ?? '').trim();
        itemTitles.set(
          `BUNDLE:${itemId}`,
          nameFr || nameEn || '(bundle supprimé)',
        );
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
      const itemType = String(row._id.itemType ?? '')
        .trim()
        .toUpperCase();
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
      notifications,
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

  async listModerationQueue(
    user: UserModel,
    status?: AdModerationStatusEnum | 'ALL',
  ): Promise<{ items: AdModerationQueueItem[] }> {
    this.assertAdmin(user);
    const bannerFilter: Record<string, unknown> = {
      store: { $exists: true, $ne: null },
    };
    const campaignFilter: Record<string, unknown> = {};
    if (!status || status === 'ALL') {
      if (!status) {
        bannerFilter.moderationStatus = AdModerationStatusEnum.PENDING_REVIEW;
        campaignFilter.moderationStatus = AdModerationStatusEnum.PENDING_REVIEW;
      }
    } else {
      bannerFilter.moderationStatus = status;
      campaignFilter.moderationStatus = status;
    }
    const [bannerDocs, campaignDocs] = await Promise.all([
      this.adModel
        .find(bannerFilter)
        .populate('store', 'name')
        .populate('product', 'title')
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
      this._adCampaignModel
        .find(campaignFilter)
        .populate('store', 'name profileImage')
        .populate('items.product', 'title profileImage price commissionRetrieveStrategy')
        .populate('items.drink', 'name imageUrl priceCad commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
        .sort({ createdAt: -1 })
        .lean()
        .exec(),
    ]);
    const bannerItems = await Promise.all(
      (bannerDocs as Record<string, unknown>[]).map(async (d) => ({
        kind: 'BANNER' as const,
        ...(await this.toManagementRowResolved(d)),
      })),
    );
    const campaignItems = await Promise.all(
      (campaignDocs as Record<string, unknown>[]).map(async (d) => ({
        kind: 'CAMPAIGN' as const,
        ...(await this._toCampaignRow(d)),
      })),
    );
    const items: AdModerationQueueItem[] = [
      ...bannerItems,
      ...campaignItems,
    ].sort((a, b) => {
      const aTs = Date.parse(a.createdAt ?? '') || 0;
      const bTs = Date.parse(b.createdAt ?? '') || 0;
      return bTs - aTs;
    });
    return { items };
  }

  async approveBannerModeration(
    user: UserModel,
    id: string,
  ): Promise<AdManagementRow> {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ad_not_found');
    }
    const existing = await this.adModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    if (!existing.store) {
      throw new BadRequestException('ad_moderation_not_applicable');
    }
    if (existing.moderationStatus !== AdModerationStatusEnum.PENDING_REVIEW) {
      throw new BadRequestException('ad_moderation_not_pending');
    }
    const storeIdStr = String(existing.store);
    const previousStatus =
      existing.moderationStatus ?? AdModerationStatusEnum.PENDING_REVIEW;
    const bannerTitle = String(existing.title ?? '').trim();
    await this.assertActiveBannerLimit(storeIdStr, user, {
      enforcePlanLimit: true,
    });
    existing.moderationStatus = AdModerationStatusEnum.APPROVED;
    existing.rejectionReason = undefined;
    existing.reviewedAt = new Date();
    existing.set('reviewedBy', user._id);
    existing.isActive = true;
    await existing.save();
    this.invalidateListCache();
    this._queueAdModerationNotify({
      kind: 'banner',
      storeId: storeIdStr,
      entityId: String(existing._id),
      entityTitle: bannerTitle,
      previousStatus,
      newStatus: AdModerationStatusEnum.APPROVED,
    });
    this.scheduleNotificationDispatchAfterSave(
      'banner',
      existing._id,
      existing.notificationAddon,
    );
    const populated = await this.adModel
      .findById(existing._id)
      .populate('store', 'name')
      .populate('product', 'title')
      .lean()
      .exec();
    return this.toManagementRowResolved(populated as Record<string, unknown>);
  }

  async rejectBannerModeration(
    user: UserModel,
    id: string,
    rejectionReason: string,
  ): Promise<AdManagementRow> {
    this.assertAdmin(user);
    const reason = rejectionReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('ad_rejection_reason_required');
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ad_not_found');
    }
    const existing = await this.adModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    if (!existing.store) {
      throw new BadRequestException('ad_moderation_not_applicable');
    }
    if (existing.moderationStatus !== AdModerationStatusEnum.PENDING_REVIEW) {
      throw new BadRequestException('ad_moderation_not_pending');
    }
    const storeIdStr = String(existing.store);
    const previousStatus =
      existing.moderationStatus ?? AdModerationStatusEnum.PENDING_REVIEW;
    const bannerTitle = String(existing.title ?? '').trim();
    existing.moderationStatus = AdModerationStatusEnum.REJECTED;
    existing.rejectionReason = reason;
    existing.reviewedAt = new Date();
    existing.set('reviewedBy', user._id);
    existing.isActive = false;
    await existing.save();
    this.invalidateListCache();
    this._queueAdModerationNotify({
      kind: 'banner',
      storeId: storeIdStr,
      entityId: String(existing._id),
      entityTitle: bannerTitle,
      previousStatus,
      newStatus: AdModerationStatusEnum.REJECTED,
      rejectionReason: reason,
    });
    const populated = await this.adModel
      .findById(existing._id)
      .populate('store', 'name')
      .populate('product', 'title')
      .lean()
      .exec();
    return this.toManagementRowResolved(populated as Record<string, unknown>);
  }

  async approveCampaignModeration(
    user: UserModel,
    id: string,
  ): Promise<AdCampaignManagementRow> {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('campaign_not_found');
    }
    const existing = await this._adCampaignModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    if (existing.moderationStatus !== AdModerationStatusEnum.PENDING_REVIEW) {
      throw new BadRequestException('ad_moderation_not_pending');
    }
    const storeIdStr = String(existing.store);
    const previousStatus =
      existing.moderationStatus ?? AdModerationStatusEnum.PENDING_REVIEW;
    const campaignTitle = String(existing.title ?? '').trim();
    await this.assertActiveCampaignLimit(storeIdStr, user, {
      enforcePlanLimit: true,
    });
    existing.moderationStatus = AdModerationStatusEnum.APPROVED;
    existing.rejectionReason = undefined;
    existing.reviewedAt = new Date();
    existing.set('reviewedBy', user._id);
    existing.isActive = true;
    await existing.save();
    this._queueAdModerationNotify({
      kind: 'campaign',
      storeId: storeIdStr,
      entityId: String(existing._id),
      entityTitle: campaignTitle,
      previousStatus,
      newStatus: AdModerationStatusEnum.APPROVED,
    });
    this.scheduleNotificationDispatchAfterSave(
      'campaign',
      existing._id,
      existing.notificationAddon,
    );
    const row = await this._adCampaignModel
      .findById(existing._id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad store commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .lean()
      .exec();
    return this._toCampaignRow(row as unknown as Record<string, unknown>);
  }

  async rejectCampaignModeration(
    user: UserModel,
    id: string,
    rejectionReason: string,
  ): Promise<AdCampaignManagementRow> {
    this.assertAdmin(user);
    const reason = rejectionReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('ad_rejection_reason_required');
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('campaign_not_found');
    }
    const existing = await this._adCampaignModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    if (existing.moderationStatus !== AdModerationStatusEnum.PENDING_REVIEW) {
      throw new BadRequestException('ad_moderation_not_pending');
    }
    const storeIdStr = String(existing.store);
    const previousStatus =
      existing.moderationStatus ?? AdModerationStatusEnum.PENDING_REVIEW;
    const campaignTitle = String(existing.title ?? '').trim();
    existing.moderationStatus = AdModerationStatusEnum.REJECTED;
    existing.rejectionReason = reason;
    existing.reviewedAt = new Date();
    existing.set('reviewedBy', user._id);
    existing.isActive = false;
    await existing.save();
    this._queueAdModerationNotify({
      kind: 'campaign',
      storeId: storeIdStr,
      entityId: String(existing._id),
      entityTitle: campaignTitle,
      previousStatus,
      newStatus: AdModerationStatusEnum.REJECTED,
      rejectionReason: reason,
    });
    const row = await this._adCampaignModel
      .findById(existing._id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad store commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .lean()
      .exec();
    return this._toCampaignRow(row as unknown as Record<string, unknown>);
  }

  async blockBannerModeration(
    user: UserModel,
    id: string,
    blockReason: string,
  ): Promise<AdManagementRow> {
    this.assertAdmin(user);
    const reason = blockReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('ad_block_reason_required');
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('ad_not_found');
    }
    const existing = await this.adModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    if (!existing.store) {
      throw new BadRequestException('ad_moderation_not_applicable');
    }
    if (existing.moderationStatus === AdModerationStatusEnum.BLOCKED) {
      throw new BadRequestException('ad_already_blocked');
    }
    const storeIdStr = String(existing.store);
    const previousStatus =
      this.moderationStatusFromDoc(
        existing.toObject() as Record<string, unknown>,
      );
    const bannerTitle = String(existing.title ?? '').trim();
    existing.moderationStatus = AdModerationStatusEnum.BLOCKED;
    existing.rejectionReason = reason;
    existing.reviewedAt = new Date();
    existing.set('reviewedBy', user._id);
    existing.isActive = false;
    await existing.save();
    this.invalidateListCache();
    this._queueAdModerationNotify({
      kind: 'banner',
      storeId: storeIdStr,
      entityId: String(existing._id),
      entityTitle: bannerTitle,
      previousStatus,
      newStatus: AdModerationStatusEnum.BLOCKED,
      rejectionReason: reason,
    });
    const populated = await this.adModel
      .findById(existing._id)
      .populate('store', 'name')
      .populate('product', 'title')
      .lean()
      .exec();
    return this.toManagementRowResolved(populated as Record<string, unknown>);
  }

  async blockCampaignModeration(
    user: UserModel,
    id: string,
    blockReason: string,
  ): Promise<AdCampaignManagementRow> {
    this.assertAdmin(user);
    const reason = blockReason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('ad_block_reason_required');
    }
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('campaign_not_found');
    }
    const existing = await this._adCampaignModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('campaign_not_found');
    }
    if (existing.moderationStatus === AdModerationStatusEnum.BLOCKED) {
      throw new BadRequestException('ad_already_blocked');
    }
    const storeIdStr = String(existing.store);
    const previousStatus =
      this.moderationStatusFromDoc(
        existing.toObject() as Record<string, unknown>,
      );
    const campaignTitle = String(existing.title ?? '').trim();
    existing.moderationStatus = AdModerationStatusEnum.BLOCKED;
    existing.rejectionReason = reason;
    existing.reviewedAt = new Date();
    existing.set('reviewedBy', user._id);
    existing.isActive = false;
    await existing.save();
    this._queueAdModerationNotify({
      kind: 'campaign',
      storeId: storeIdStr,
      entityId: String(existing._id),
      entityTitle: campaignTitle,
      previousStatus,
      newStatus: AdModerationStatusEnum.BLOCKED,
      rejectionReason: reason,
    });
    const row = await this._adCampaignModel
      .findById(existing._id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price store commissionRetrieveStrategy')
      .populate('items.drink', 'name imageUrl priceCad store commissionRetrieveStrategy')
      .populate('items.productBundle', 'nameFr nameEn image')
      .lean()
      .exec();
    return this._toCampaignRow(row as unknown as Record<string, unknown>);
  }
}
