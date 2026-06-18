import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { AddressesService } from '@modules/addresses/addresses.service';
import { CartService } from '@modules/cart/cart.service';
import { AddItemToCartDto } from '@modules/cart/dto/cart.dto';
import { MediasService } from '@modules/medias/medias.service';
import { CreateOfferDto } from '@modules/offers/dto/offers.dto';
import { OffersService } from '@modules/offers/offers.service';
import { OrdersService } from '@modules/orders/orders.service';
import {
  CreateProductDto,
  CreateProductExtraDto,
  PatchProductDto,
} from '@modules/products/dto/products.dto';
import { ProductsService } from '@modules/products/products.service';
import { ProductCategoryService } from '@modules/products/product-category.service';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { RatingsService } from '@modules/ratings/ratings.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { EmailTemplateService } from '@modules/mailer/email-template.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { UsersService } from '@modules/users/users.service';
import {
  AppCacheKeys,
  apiPublicCacheTtlMs,
  bustCatalogListingPublicCaches,
  getOrSetCache,
} from '@common/redis-app-cache';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AddressTypeEnum } from '@schemas/address.schema';
import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { AddressModel } from '@schemas/address.schema';
import { isDemoProductRaterEmail } from '@modules/ratings/demo-product-rating-users';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import { ProductModel } from '@schemas/product.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import {
  MealPreOrderCatalogScopeEnum,
  StoreModel,
  StoreStatusEnum,
} from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { Cache } from 'cache-manager';
import { Model, Types } from 'mongoose';
import {
  CreateStoreDto,
  DailyMenuItemDto,
  DailyMenuSlotDto,
  PatchVendorShippingZonesDto,
} from './dto/store.dto';
import { VendorInvitationDto } from './dto/vendor-invitation.dto';
import { AdminPatchVendorStoreDto } from './dto/admin-vendor-store.dto';
import {
  DrinksService,
  maxDrinkOrderQuantity,
} from '@modules/drinks/drinks.service';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import { VendorStatusEmailService } from '@modules/vendor-emails/vendor-status-email.service';
import {
  isStripeConnectOnboardingCompleteUser,
  resolveStripeOnboardingStatusLabel,
} from '@modules/billing/stripe/stripe-connect-visibility';
import {
  isPartnerBadgeCode,
  PartnerBadgeCode,
  resolveEffectivePartnerBadgeCode,
  serializePartnerBadge,
} from '@common/partner-badges/partner-badge.constants';
import { WsInboxNotifyService } from '@modules/ws-notify/ws-inbox-notify.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { TeamsService } from '@modules/teams/teams.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { BusinessTypesService } from '@modules/business-types/business-types.service';
import { DashboardAuditService } from '@modules/dashboard-audit/dashboard-audit.service';
import { SitemapDispatchService } from '@modules/public-seo/sitemap-dispatch.service';

@Injectable()
export class StoreService {
  private readonly _logger = new Logger(StoreService.name);

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
   * Dossier vendeur : adresse textuelle complète + coordonnées réelles sur la carte
   * (requis pour la recherche par proximité et la validation du dossier).
   */
  private _assertVendorShopAddressForOnboarding(addr: CreateAddressDto): void {
    const street = (addr.address ?? '').trim();
    const city = (addr.city ?? '').trim();
    const zip = (addr.zipCode ?? '').trim();
    const country = (addr.country ?? '').trim();
    const cc = (addr.countryCode ?? '').trim();
    if (!street || !city || !zip || !country || !cc) {
      throw new BadRequestException('shop_address_incomplete');
    }
    const lat = addr.latitude;
    const lng = addr.longitude;
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      throw new BadRequestException('shop_coordinates_required');
    }
    if (Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5) {
      throw new BadRequestException('shop_coordinates_invalid');
    }
  }

  /** Devise imposée par le pays sélectionné (régions actives). */
  private async _resolveCurrencyForCountryCode(
    countryCode: string,
  ): Promise<string> {
    const code = String(countryCode ?? '').toUpperCase();
    if (!code) {
      throw new BadRequestException('address_country_required');
    }
    const currency = await this._supportedCountries.getCurrency(code);
    if (!currency) {
      throw new BadRequestException('country_currency_not_configured');
    }
    return currency;
  }

  /** Région enregistrée (ISO) : champ `region` ou repli `address.countryCode` (legacy). */
  private _resolveStoreRegion(dto: {
    region?: string;
    address?: { countryCode?: string };
  }): string {
    const fromField = String(dto.region ?? '')
      .trim()
      .toUpperCase();
    if (/^[A-Z]{2}$/.test(fromField)) return fromField;
    const fromAddress = String(dto.address?.countryCode ?? '')
      .trim()
      .toUpperCase();
    if (/^[A-Z]{2}$/.test(fromAddress)) return fromAddress;
    throw new BadRequestException('store_region_required');
  }

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @InjectModel(AddressModel.name)
  private readonly _addressModel: Model<AddressModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(ProductRatingModel.name)
  private readonly _productRatingModel: Model<ProductRatingModel>;

  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @InjectModel(VendorSubscriptionModel.name)
  private readonly _vendorSubscriptionModel: Model<VendorSubscriptionModel>;

  @Inject(AddressesService)
  private readonly _addressesService: AddressesService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(ProductCategoryService)
  private readonly _productCategoryService: ProductCategoryService;

  @Inject(UsersService)
  private readonly _usersService: UsersService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(RatingsService)
  private readonly _ratingsService: RatingsService;

  @Inject(OffersService)
  private readonly _offersService: OffersService;

  @Inject(CartService)
  private readonly _cartService: CartService;

  @Inject(OrdersService)
  private readonly _ordersService: OrdersService;

  @Inject(ConfigService)
  private readonly _configService: ConfigService;

  @Inject(CACHE_MANAGER)
  private readonly _cache: Cache;

  @Inject(MailerService)
  private readonly _mailerService: MailerService;

  @Inject(EmailTemplateService)
  private readonly _emailTpl: EmailTemplateService;

  @Inject(WsInboxNotifyService)
  private readonly _wsInboxNotify: WsInboxNotifyService;

  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(TeamsService)
  private readonly _teamsService: TeamsService;

  @Inject(StripeConnectService)
  private readonly _stripeConnect: StripeConnectService;

  @Inject(VendorStatusEmailService)
  private readonly _vendorStatusEmail: VendorStatusEmailService;

  @Inject(SubscriptionsService)
  private readonly _subscriptionsService: SubscriptionsService;

  @Inject(BusinessTypesService)
  private readonly _businessTypesService: BusinessTypesService;

  private _normalizeVendorDeliveryDriverSettings(args: {
    supportsShipping: boolean;
    vendorManagesDeliveryDrivers?: boolean;
    deliveryAssignmentMode?: string;
  }): {
    vendorManagesDeliveryDrivers: boolean;
    deliveryAssignmentMode: 'AUTO' | 'MANUAL';
  } {
    const vendorManagesDeliveryDrivers =
      args.supportsShipping && args.vendorManagesDeliveryDrivers === true;
    const deliveryAssignmentMode =
      vendorManagesDeliveryDrivers &&
      String(args.deliveryAssignmentMode ?? 'AUTO').toUpperCase() === 'MANUAL'
        ? 'MANUAL'
        : 'AUTO';
    return { vendorManagesDeliveryDrivers, deliveryAssignmentMode };
  }

  private _normalizeMealPreOrdersFlag(
    acceptsMealPreOrders?: boolean,
  ): boolean {
    return acceptsMealPreOrders === true;
  }

  private _docAcceptsMealPreOrders(doc: Record<string, unknown>): boolean {
    return (
      doc.acceptsMealPreOrders === true ||
      doc.accepts_meal_pre_orders === true ||
      doc.acceptsPreProgrammedFoodDeliveries === true ||
      doc.accepts_pre_programmed_food_deliveries === true
    );
  }

  private async _mealPreOrderEnabledForStore(storeId: string): Promise<boolean> {
    return this._subscriptionsService.isMealPreOrderEnabledForStore(storeId);
  }

  private async _assertMealPreOrdersAllowedForStore(
    storeId: string,
    wantsPreOrders: boolean,
  ): Promise<void> {
    if (!wantsPreOrders) return;
    const allowed = await this._mealPreOrderEnabledForStore(storeId);
    if (!allowed) {
      throw new ForbiddenException('meal_pre_order_not_in_plan');
    }
  }

  private _effectiveAcceptsMealPreOrders(
    doc: Record<string, unknown>,
    planAllows: boolean,
  ): boolean {
    return planAllows && this._docAcceptsMealPreOrders(doc);
  }

  private _normalizeMealPreOrderCatalogScope(
    value?: string | MealPreOrderCatalogScopeEnum | null,
  ): MealPreOrderCatalogScopeEnum {
    return String(value ?? '').toUpperCase() ===
      MealPreOrderCatalogScopeEnum.CATALOG
      ? MealPreOrderCatalogScopeEnum.CATALOG
      : MealPreOrderCatalogScopeEnum.DAILY_MENU;
  }

  private _docMealPreOrderCatalogScope(
    doc: Record<string, unknown>,
  ): MealPreOrderCatalogScopeEnum {
    return this._normalizeMealPreOrderCatalogScope(
      String(
        doc.mealPreOrderCatalogScope ??
          doc.meal_pre_order_catalog_scope ??
          '',
      ),
    );
  }

  @Inject(DashboardAuditService)
  private readonly _dashboardAudit: DashboardAuditService;

  @Inject(SitemapDispatchService)
  private readonly _sitemapDispatch: SitemapDispatchService;

  getStoreModel() {
    return this._storeModel;
  }

  /** Boutique ACTIVE — vitrine web publique (sans exiger Stripe Connect). */
  async isStoreVisibleOnPublicCatalog(storeId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(storeId)) {
      return false;
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('status')
      .lean()
      .exec();
    return store?.status === StoreStatusEnum.ACTIVE;
  }

  /**
   * Boutique visible dans l’app mobile client : ACTIVE + onboarding Stripe Connect du vendeur terminé.
   */
  async isStoreVisibleOnMobileApp(storeId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(storeId)) {
      return false;
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('status owner')
      .lean()
      .exec();
    if (!store || store.status !== StoreStatusEnum.ACTIVE) {
      return false;
    }
    if (!store.owner) {
      return false;
    }
    const ownerOid =
      store.owner instanceof Types.ObjectId
        ? store.owner
        : new Types.ObjectId(String(store.owner));
    const owner = await this._userModel
      .findById(ownerOid)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    return isStripeConnectOnboardingCompleteUser(owner);
  }

  async isStoreVisibleForClient(
    storeId: string,
    clientPlatform?: string,
  ): Promise<boolean> {
    if (clientPlatform === 'web') {
      return this.isStoreVisibleOnPublicCatalog(storeId);
    }
    return this.isStoreVisibleOnMobileApp(storeId);
  }

  async assertStoreVisibleOnMobileApp(storeId: string): Promise<void> {
    const ok = await this.isStoreVisibleOnMobileApp(storeId);
    if (!ok) {
      throw new NotFoundException('store_not_found');
    }
  }

  async assertStoreVisibleForClient(
    storeId: string,
    clientPlatform?: string,
  ): Promise<void> {
    const ok = await this.isStoreVisibleForClient(storeId, clientPlatform);
    if (!ok) {
      throw new NotFoundException('store_not_found');
    }
  }

  async findOneById(
    id: string,
    options?: {
      requireMobileVisibility?: boolean;
      clientPlatform?: string;
    },
  ) {
    if (options?.requireMobileVisibility) {
      await this.assertStoreVisibleForClient(id, options.clientPlatform);
    }
    const store = await this._storeModel
      .findOne({ _id: id })
      .populate('address')
      .populate('owner')
      .populate('ratings')
      .populate('likedBy')
      .exec();
    if (store?.dailyMenuByWeekday?.length) {
      const dailyMenuLimit =
        await this._subscriptionsService.resolveDailyMenuItemLimitForStore(id);
      (store as unknown as { dailyMenuByWeekday: unknown }).dailyMenuByWeekday =
        this.normalizeDailyMenuForApi(
          store.dailyMenuByWeekday as Record<string, unknown>[],
          dailyMenuLimit,
        );
    }
    return store;
  }

  /**
   * Note boutique affichée client : moyenne des avis plats
   * (somme des `rate` / nombre d’avis), hors comptes démo seed.
   */
  private async productReviewsAverageForStore(
    storeOid: Types.ObjectId,
  ): Promise<{ averageRating: number; reviewCount: number }> {
    const rows = await this._productRatingModel
      .aggregate<{ rate?: number; userEmail?: string }>([
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'p',
          },
        },
        { $unwind: '$p' },
        { $match: { 'p.store': storeOid } },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'u',
          },
        },
        {
          $project: {
            rate: 1,
            userEmail: { $arrayElemAt: ['$u.email', 0] },
          },
        },
      ])
      .exec();

    let sum = 0;
    let count = 0;
    for (const row of rows) {
      if (isDemoProductRaterEmail(row.userEmail)) continue;
      const rate = Number(row.rate);
      if (!Number.isFinite(rate)) continue;
      sum += Math.min(5, Math.max(1, Math.round(rate)));
      count += 1;
    }
    if (count === 0) {
      return { averageRating: 0, reviewCount: 0 };
    }
    const averageRating = Math.round((sum / count) * 10) / 10;
    return { averageRating, reviewCount: count };
  }

  /**
   * Fiche minimale pour l’écran « menu boutique » app (sans populate) — beaucoup plus rapide que {@link findOneById}.
   */
  async findPublicStoreMenuMeta(
    id: string,
    options?: { clientPlatform?: string },
  ): Promise<Record<string, unknown> | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    if (!(await this.isStoreVisibleForClient(id, options?.clientPlatform))) {
      return null;
    }
    return getOrSetCache(
      this._cache,
      AppCacheKeys.storeMeta(id),
      apiPublicCacheTtlMs(),
      () => this._loadPublicStoreMenuMeta(id),
    );
  }

  private async _loadPublicStoreMenuMeta(
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const storeOid = new Types.ObjectId(id);
    const doc = await this._storeModel
      .findById(storeOid)
      .select(
        'bio profileImage name status email phoneNumber currency supportsShipping acceptsOrders acceptsMealPreOrders mealPreOrderCatalogScope',
      )
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode label location',
      })
      .lean()
      .exec();
    if (doc == null) {
      return null;
    }
    const [{ averageRating, reviewCount }, ordersCount, planByStore] =
      await Promise.all([
        this.productReviewsAverageForStore(storeOid),
        this._orderModel
          .countDocuments({
            store: storeOid,
            status: { $ne: OrderStatusEnum.CANCELLED },
          })
          .exec(),
        this._resolveSubscriptionPlanByStoreIds([id]),
      ]);
    const planName =
      String(planByStore.get(id) ?? '').trim() || 'FREE';
    const storeSubscriptionEnabled =
      await this._subscriptionsService.isStoreSubscriptionEnabledForPlanName(
        planName,
      );
    const mealPreOrderPlanEnabled =
      await this._subscriptionsService.isMealPreOrderEnabledForPlanName(
        planName,
      );
    const o = doc as unknown as Record<string, unknown>;
    const plain: Record<string, unknown> = {
      ...o,
      averageRating,
      reviewCount,
      ordersCount,
      subscriptionPlan: planName,
      storeSubscriptionEnabled,
      mealPreOrderPlanEnabled,
      acceptsMealPreOrders: this._effectiveAcceptsMealPreOrders(
        o,
        mealPreOrderPlanEnabled,
      ),
      mealPreOrderCatalogScope: this._docMealPreOrderCatalogScope(o),
    };
    const oid = o['_id'];
    if (
      oid != null &&
      typeof (oid as { toString?: () => string }).toString === 'function'
    ) {
      plain['id'] = (oid as { toString: () => string }).toString();
    }
    delete plain['_id'];
    delete plain['__v'];
    return plain;
  }

  async create(dto: CreateStoreDto, user: UserModel) {
    const { address, ...args } = dto;
    this._assertVendorShopAddressForOnboarding(address);
    await this._businessTypesService.assertActiveSlug(args.businessType);
    const fullUser = await this._usersService.findById(
      (user._id as { toString(): string }).toString(),
    );
    await this._supportedCountries.assertVendorApplicationCompatible(
      fullUser,
      dto,
    );
    const storeRegion = this._resolveStoreRegion(dto);
    const derivedCurrency = await this._resolveCurrencyForCountryCode(
      storeRegion,
    );
    const ownerStoreCount = await this._storeModel
      .countDocuments({ owner: user._id })
      .exec();
    const creationLimit =
      await this._subscriptionsService.resolveStoreCreationLimitForOwner(
        user._id as Types.ObjectId,
      );
    if (creationLimit != null && ownerStoreCount >= creationLimit) {
      throw new ForbiddenException('store_limit_reached_for_plan');
    }
    const exists = await this._storeModel.findOne({ name: args.name }).exec();

    if (exists) {
      throw new ConflictException('store_already_exists');
    }

    const wantsPreOrders = this._normalizeMealPreOrdersFlag(
      args.acceptsMealPreOrders,
    );
    if (wantsPreOrders) {
      const allowed =
        await this._subscriptionsService.isMealPreOrderEnabledForPlanName(
          'FREE',
        );
      if (!allowed) {
        throw new ForbiddenException('meal_pre_order_not_in_plan');
      }
    }

    const addr = await this._addressesService.create(
      {
        ...address,
        type: AddressTypeEnum.SHOP,
      },
      user,
    );

    if (!addr) {
      throw new ConflictException('address_not_found');
    }

    const store = await this._storeModel.create({
      ...args,
      region: storeRegion,
      currency: derivedCurrency,
      address: addr._id,
      owner: user._id,
      ...this._normalizeVendorDeliveryDriverSettings(args),
      acceptsMealPreOrders: wantsPreOrders,
      mealPreOrderCatalogScope: this._normalizeMealPreOrderCatalogScope(
        args.mealPreOrderCatalogScope,
      ),
    });

    if (!store) {
      throw new BadRequestException('could_not_create_store');
    }

    await this._usersService.addStore(store, user);

    await this._storeModel.updateOne(
      { _id: store._id },
      {
        $push: {
          vendorMessages: {
            message:
              'Votre dossier a bien été reçu. Notre équipe examine votre demande. Toute mise à jour apparaîtra ici.',
            from: 'SYSTEM',
            createdAt: new Date(),
          },
        },
      },
    );

    this._wsInboxNotify.notifyUserInboxRefresh(
      (user._id as { toString(): string }).toString(),
    );

    await this._teamsService.bootstrapStoreTeam(
      store._id.toString(),
      user._id as Types.ObjectId,
    );

    await this._subscriptionsService.ensureStoreDefaultFreePlan(
      store._id as Types.ObjectId,
      user._id as Types.ObjectId,
    );

    return this.findOneById(store._id.toString());
  }

  /** Résumé boutique pour l’écran vendeur (statut + messages + fiche éditable si PENDING/REVISION). */
  async findMyStoreSummary(user: UserModel, storeId?: string) {
    const access = await this._storeAccess.resolveStoreAccess(user);
    const requested = storeId?.trim();
    let targetId = requested;
    if (!targetId) {
      const owned =
        access.find((a) => a.isOwner)?.storeId ?? access[0]?.storeId;
      targetId = owned;
    }
    if (!targetId) {
      return { store: null as null };
    }
    const row = access.find((a) => a.storeId === targetId);
    if (!row) {
      throw new ForbiddenException('store_not_found');
    }

    const store = await this._storeModel
      .findById(targetId)
      .populate({
        path: 'address',
        select: 'address city country zipCode countryCode location',
      })
      .select(
        'name bio businessType email phoneNumber currency region status vendorMessages acceptsOrders canCreateProducts createdAt updatedAt supportsShipping shippingZones vendorManagesDeliveryDrivers deliveryAssignmentMode address profileImage dailyMenuByWeekday owner acceptsMealPreOrders mealPreOrderCatalogScope partnerBadgeCode',
      )
      .lean()
      .exec();
    if (!store) {
      return { store: null as null };
    }
    const isOwner =
      row.isOwner ||
      String((store as { owner?: { toString(): string } }).owner ?? '') ===
        String(user._id);
    const doc = store as Record<string, unknown>;
    const raw = (doc.vendorMessages as Record<string, unknown>[]) ?? [];
    const messages = [...raw].sort(
      (a, b) =>
        new Date(String(b.createdAt)).getTime() -
        new Date(String(a.createdAt)).getTime(),
    );
    const st = doc.status as StoreStatusEnum;
    const canEditApplication =
      isOwner &&
      [StoreStatusEnum.PENDING, StoreStatusEnum.REVISION].includes(st);

    const addr = doc.address as AddressModel & {
      location?: { coordinates?: number[] };
    };
    const coords = addr?.location?.coordinates ?? [0, 0];
    const zones = (doc.shippingZones as Record<string, unknown>[]) ?? [];
    /** Fiche complète pour l’UI (lecture / édition selon canEditApplication). */
    const profile = {
      name: String(doc.name ?? ''),
      bio: String(doc.bio ?? ''),
      businessType: doc.businessType
        ? String(doc.businessType)
        : undefined,
      email: String(doc.email ?? ''),
      phoneNumber: String(doc.phoneNumber ?? ''),
      currency: String(doc.currency ?? 'CAD'),
      region: String(
        doc.region ?? addr?.countryCode ?? '',
      )
        .trim()
        .toUpperCase(),
      supportsShipping: !!doc.supportsShipping,
      acceptsMealPreOrders: this._docAcceptsMealPreOrders(
        doc as Record<string, unknown>,
      ),
      mealPreOrderCatalogScope: this._docMealPreOrderCatalogScope(
        doc as Record<string, unknown>,
      ),
      vendorManagesDeliveryDrivers: !!doc.vendorManagesDeliveryDrivers,
      deliveryAssignmentMode: String(
        doc.deliveryAssignmentMode ?? 'AUTO',
      ).toUpperCase(),
      shippingZones: zones.map((z) => ({
        minDistance: Number(z.minDistance ?? 0),
        maxDistance: Number(z.maxDistance ?? 0),
        price: Number(z.price ?? 0),
      })),
      address: {
        address: addr?.address ?? '',
        city: addr?.city ?? '',
        country: addr?.country ?? '',
        zipCode: addr?.zipCode ?? '',
        countryCode: addr?.countryCode ?? 'CA',
        latitude: coords[1] ?? 0,
        longitude: coords[0] ?? 0,
      },
    };

    const profileImage = await this._mediasService.resolvePublicMediaUrl(
      typeof doc.profileImage === 'string' ? doc.profileImage : undefined,
    );

    const rawMenu =
      (doc.dailyMenuByWeekday as Array<Record<string, unknown>> | undefined) ??
      [];
    const dailyMenuLimit =
      await this._subscriptionsService.resolveDailyMenuItemLimitForStore(
        targetId,
      );
    const dailyMenuByWeekday = this.normalizeDailyMenuForApi(
      rawMenu,
      dailyMenuLimit,
    );
    const mealPreOrderPlanEnabled =
      await this._mealPreOrderEnabledForStore(targetId);

    return {
      store: {
        id: (doc._id as { toString(): string }).toString(),
        name: doc.name as string,
        status: doc.status as string,
        acceptsOrders: !!doc.acceptsOrders,
        canCreateProducts: !!doc.canCreateProducts,
        supportsShipping: !!doc.supportsShipping,
        acceptsMealPreOrders: this._docAcceptsMealPreOrders(
          doc as Record<string, unknown>,
        ),
        mealPreOrderPlanEnabled,
        vendorManagesDeliveryDrivers: !!doc.vendorManagesDeliveryDrivers,
        deliveryAssignmentMode: String(
          doc.deliveryAssignmentMode ?? 'AUTO',
        ).toUpperCase(),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        currency: profile.currency,
        canEditApplication,
        profile,
        application: canEditApplication ? profile : null,
        messages: messages.map((m) => ({
          message: String(m.message ?? ''),
          from: String(m.from ?? 'SYSTEM'),
          createdAt: m.createdAt,
        })),
        profileImage,
        dailyMenuByWeekday,
        partnerBadge: serializePartnerBadge(
          String(doc.partnerBadgeCode ?? '').trim() || null,
        ),
      },
    };
  }

  async updateVendorDailyMenu(
    storeId: string,
    user: UserModel,
    slots: DailyMenuSlotDto[],
  ) {
    this.assertVendorStripeConnectReadyForWrites(user);
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    const merged = new Map<
      number,
      Array<{
        productId: string;
        stockUnlimited: boolean;
        stockRemaining: number;
        addonsAvailability?: DailyMenuItemDto['addonsAvailability'];
      }>
    >();
    const dailyMenuLimit =
      await this._subscriptionsService.resolveDailyMenuItemLimitForStore(
        storeId,
      );
    for (let d = 0; d <= 6; d++) {
      merged.set(d, []);
    }
    for (const s of slots) {
      const d = Math.min(6, Math.max(0, Math.floor(Number(s.dayOfWeek))));
      const entries = this.dailyMenuEntriesFromSlotDto(s);
      const byPid = new Map<
        string,
        {
          productId: string;
          stockUnlimited: boolean;
          stockRemaining: number;
          addonsAvailability?: DailyMenuItemDto['addonsAvailability'];
        }
      >();
      for (const e of entries) {
        byPid.set(e.productId, e);
      }
      if (dailyMenuLimit != null && byPid.size > dailyMenuLimit) {
        throw new ForbiddenException('daily_menu_limit_reached_for_plan');
      }
      merged.set(d, [...byPid.values()]);
    }

    const allIds = [
      ...new Set([...merged.values()].flat().map((e) => e.productId)),
    ];
    if (allIds.length) {
      const n = await this._productModel
        .countDocuments({
          store: storeId,
          _id: { $in: allIds },
        })
        .exec();
      if (n !== allIds.length) {
        throw new BadRequestException('daily_menu_product_not_in_store');
      }
    }

    const dailyMenuByWeekday = [...merged.entries()].map(
      ([dayOfWeek, itemList]) => ({
        dayOfWeek,
        items: itemList.map((it) => {
          const doc: Record<string, unknown> = {
            productId: new Types.ObjectId(it.productId),
            stockUnlimited: it.stockUnlimited,
            stockRemaining: it.stockUnlimited
              ? 0
              : Math.max(0, it.stockRemaining),
          };
          const addons = this.sanitizeAddonsAvailability(it.addonsAvailability);
          if (addons) doc.addonsAvailability = addons;
          return doc;
        }),
      }),
    );

    await this._storeModel
      .updateOne({ _id: storeId }, { $set: { dailyMenuByWeekday } })
      .exec();

    await this._invalidatePublicCatalogCachesForStore(storeId);

    return this.findMyStoreSummary(user);
  }

  /** Changements menu / commandes / livraison → listing client (recherche, accueil, menu boutique). */
  private async _invalidatePublicCatalogCachesForStore(
    storeId: string,
  ): Promise<void> {
    try {
      await bustCatalogListingPublicCaches(this._cache, storeId);
      await this._productCategoryService.invalidatePublicListCache();
    } catch (err) {
      this._logger.warn(
        `public catalog cache bust failed for store ${storeId}: ${(err as Error).message}`,
      );
    }
  }

  /** @deprecated use {@link _invalidatePublicCatalogCachesForStore} */
  private async _invalidateCatalogListingAfterDailyMenuChange(
    storeId: string,
  ): Promise<void> {
    await this._invalidatePublicCatalogCachesForStore(storeId);
  }

  private stringifyIdLike(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      return (value as { toString(): string }).toString();
    }
    return String(value);
  }

  /** Menu du jour normalisé pour l’API (app mobile + dashboard). */
  private normalizeDailyMenuForApi(
    rows: Array<Record<string, unknown>> | undefined | null,
    maxItemsPerDay?: number | null,
  ): Array<{
    dayOfWeek: number;
    items: Array<{
      productId: string;
      stockUnlimited: boolean;
      stockRemaining: number;
      soldOut: boolean;
      addonsAvailability?: DailyMenuItemDto['addonsAvailability'];
    }>;
  }> {
    if (!rows?.length) return [];
    return rows.map((row) => {
      const dayOfWeek = Math.min(
        6,
        Math.max(0, Number((row as { dayOfWeek?: number }).dayOfWeek ?? 0)),
      );
      const items: Array<{
        productId: string;
        stockUnlimited: boolean;
        stockRemaining: number;
        soldOut: boolean;
        addonsAvailability?: DailyMenuItemDto['addonsAvailability'];
      }> = [];
      const rawItems = (row as { items?: unknown[] }).items;
      if (Array.isArray(rawItems) && rawItems.length) {
        for (const it of rawItems) {
          const o = it as Record<string, unknown>;
          const pid = this.stringifyIdLike(o.productId);
          if (!pid) continue;
          const stockUnlimited = Boolean(o.stockUnlimited ?? true);
          const stockRemaining = stockUnlimited
            ? 0
            : Math.max(0, Math.floor(Number(o.stockRemaining ?? 0)));
          const addons = this.parseAddonsAvailabilityFromDoc(o.addonsAvailability);
          items.push({
            productId: pid,
            stockUnlimited,
            stockRemaining,
            soldOut: !stockUnlimited && stockRemaining <= 0,
            ...(addons ? { addonsAvailability: addons } : {}),
          });
        }
      } else {
        const pids = (row as { productIds?: unknown[] }).productIds;
        if (Array.isArray(pids)) {
          for (const id of pids) {
            const pid = this.stringifyIdLike(id);
            if (!pid) continue;
            items.push({
              productId: pid,
              stockUnlimited: true,
              stockRemaining: 0,
              soldOut: false,
            });
          }
        }
      }
      const cappedItems =
        maxItemsPerDay != null && maxItemsPerDay > 0
          ? items.slice(0, maxItemsPerDay)
          : items;
      return { dayOfWeek, items: cappedItems };
    });
  }

  private dailyMenuEntriesFromSlotDto(s: DailyMenuSlotDto): {
    productId: string;
    stockUnlimited: boolean;
    stockRemaining: number;
    addonsAvailability?: DailyMenuItemDto['addonsAvailability'];
  }[] {
    if (s.items?.length) {
      return s.items.map((i) => ({
        productId: String(i.productId).trim(),
        stockUnlimited: !!i.stockUnlimited,
        stockRemaining: i.stockUnlimited
          ? 0
          : Math.max(0, Math.floor(Number(i.stockRemaining ?? 0))),
        addonsAvailability: this.sanitizeAddonsAvailability(
          i.addonsAvailability,
        ),
      }));
    }
    return (s.productIds ?? [])
      .map(String)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((productId) => ({
        productId,
        stockUnlimited: true,
        stockRemaining: 0,
      }));
  }

  private parseAddonsAvailabilityFromDoc(
    raw: unknown,
  ): DailyMenuItemDto['addonsAvailability'] | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    return this.sanitizeAddonsAvailability({
      variantIndexes: Array.isArray(o.variantIndexes)
        ? (o.variantIndexes as unknown[]).map((n) => Number(n))
        : undefined,
      complements: Array.isArray(o.complements)
        ? (o.complements as unknown[]).map((row) => {
            const r = row as Record<string, unknown>;
            return {
              groupIndex: Number(r.groupIndex),
              optionIndexes: Array.isArray(r.optionIndexes)
                ? (r.optionIndexes as unknown[]).map((n) => Number(n))
                : [],
            };
          })
        : undefined,
      supplementIndexes: Array.isArray(o.supplementIndexes)
        ? (o.supplementIndexes as unknown[]).map((n) => Number(n))
        : undefined,
    });
  }

  private sanitizeAddonsAvailability(
    raw: DailyMenuItemDto['addonsAvailability'] | undefined,
  ): DailyMenuItemDto['addonsAvailability'] | undefined {
    if (!raw) return undefined;
    const out: DailyMenuItemDto['addonsAvailability'] = {};
    if (Array.isArray(raw.variantIndexes)) {
      out.variantIndexes = [
        ...new Set(
          raw.variantIndexes
            .map((n) => Math.floor(Number(n)))
            .filter((n) => n >= 0),
        ),
      ].sort((a, b) => a - b);
    }
    if (Array.isArray(raw.complements) && raw.complements.length) {
      const groups = raw.complements
        .map((g) => ({
          groupIndex: Math.floor(Number(g.groupIndex)),
          optionIndexes: [
            ...new Set(
              (g.optionIndexes ?? [])
                .map((n) => Math.floor(Number(n)))
                .filter((n) => n >= 0),
            ),
          ].sort((a, b) => a - b),
        }))
        .filter((g) => g.groupIndex >= 0 && g.optionIndexes.length > 0)
        .sort((a, b) => a.groupIndex - b.groupIndex);
      if (groups.length) out.complements = groups;
    }
    if (Array.isArray(raw.supplementIndexes)) {
      out.supplementIndexes = [
        ...new Set(
          raw.supplementIndexes
            .map((n) => Math.floor(Number(n)))
            .filter((n) => n >= 0),
        ),
      ].sort((a, b) => a - b);
    }
    if (Object.keys(out).length === 0) {
      return undefined;
    }
    return out;
  }

  private async dailyMenuNeedsLimitedDecrement(
    storeId: string,
    dayOfWeek: number,
    productId: string,
  ): Promise<boolean> {
    const doc = await this._storeModel
      .findById(storeId)
      .select('dailyMenuByWeekday')
      .lean()
      .exec();
    const dailyMenuLimit =
      await this._subscriptionsService.resolveDailyMenuItemLimitForStore(
        storeId,
      );
    const rows = this.normalizeDailyMenuForApi(
      (doc?.dailyMenuByWeekday as Record<string, unknown>[]) ?? [],
      dailyMenuLimit,
    );
    const entry = rows
      .find((r) => r.dayOfWeek === dayOfWeek)
      ?.items.find((i) => i.productId === productId);
    return !!entry && !entry.stockUnlimited;
  }

  private async doAtomicDecrementDailyMenuProductStock(
    storeId: string,
    dayOfWeek: number,
    productId: string,
    qty: number,
  ): Promise<boolean> {
    const dow = Math.min(6, Math.max(0, dayOfWeek));
    const pid = new Types.ObjectId(productId);
    const res = await this._storeModel.updateOne(
      {
        _id: storeId,
        dailyMenuByWeekday: {
          $elemMatch: {
            dayOfWeek: dow,
            items: {
              $elemMatch: {
                productId: pid,
                stockUnlimited: false,
                stockRemaining: { $gte: qty },
              },
            },
          },
        },
      },
      {
        $inc: { 'dailyMenuByWeekday.$[slot].items.$[it].stockRemaining': -qty },
      },
      {
        arrayFilters: [
          { 'slot.dayOfWeek': dow },
          { 'it.productId': pid, 'it.stockUnlimited': false },
        ],
      },
    );
    return res.modifiedCount === 1;
  }

  private async atomicIncrementDailyMenuProductStock(
    storeId: string,
    dayOfWeek: number,
    productId: string,
    qty: number,
  ): Promise<void> {
    const dow = Math.min(6, Math.max(0, dayOfWeek));
    const pid = new Types.ObjectId(productId);
    await this._storeModel.updateOne(
      { _id: storeId },
      {
        $inc: { 'dailyMenuByWeekday.$[slot].items.$[it].stockRemaining': qty },
      },
      {
        arrayFilters: [
          { 'slot.dayOfWeek': dow },
          { 'it.productId': pid, 'it.stockUnlimited': false },
        ],
      },
    );
  }

  private async tryConsumeDailyMenuStock(
    storeId: string,
    dayOfWeek: number,
    productId: string,
    qty: number,
  ): Promise<'skip' | 'ok' | 'fail'> {
    if (
      !(await this.dailyMenuNeedsLimitedDecrement(
        storeId,
        dayOfWeek,
        productId,
      ))
    ) {
      return 'skip';
    }
    const ok = await this.doAtomicDecrementDailyMenuProductStock(
      storeId,
      dayOfWeek,
      productId,
      qty,
    );
    return ok ? 'ok' : 'fail';
  }

  /** Menu du jour actif pour aujourd’hui (au moins un plat listé). */
  private todayDailyMenuSlot(
    rows: Array<{
      dayOfWeek: number;
      items: Array<{
        productId: string;
        stockUnlimited: boolean;
        stockRemaining: number;
        soldOut: boolean;
      }>;
    }>,
  ) {
    const dow = new Date().getDay();
    const slot = rows.find((r) => r.dayOfWeek === dow);
    if (!slot?.items?.length) return null;
    return slot;
  }

  private async assertDailyMenuProductAddAllowed(
    storeId: string,
    user: UserModel,
    args: AddItemToCartDto,
  ): Promise<void> {
    if (args.type !== CartItemTypeEnum.PRODUCT) return;
    const doc = await this._storeModel
      .findById(storeId)
      .select('dailyMenuByWeekday')
      .lean()
      .exec();
    const dailyMenuLimit =
      await this._subscriptionsService.resolveDailyMenuItemLimitForStore(
        storeId,
      );
    const rows = this.normalizeDailyMenuForApi(
      (doc?.dailyMenuByWeekday as Record<string, unknown>[]) ?? [],
      dailyMenuLimit,
    );
    const slot = this.todayDailyMenuSlot(rows);
    if (!slot) {
      return;
    }
    const itemId = this.stringifyIdLike(args.itemId);
    const entry = slot.items.find(
      (i) => this.stringifyIdLike(i.productId) === itemId,
    );
    if (!entry) {
      throw new BadRequestException('daily_menu_product_not_available');
    }
    if (!entry.stockUnlimited && entry.stockRemaining <= 0) {
      throw new BadRequestException('daily_menu_product_not_available');
    }
    if (entry.stockUnlimited) return;
    const inCart = await this._cartService.sumQuantityForProductInCart(
      storeId,
      user.id.toString(),
      args.itemId,
    );
    if (inCart + args.quantity > entry.stockRemaining) {
      throw new BadRequestException('daily_menu_insufficient_stock');
    }
  }

  private async assertDailyMenuStockForCart(
    store: StoreModel,
    cart: {
      items: Array<{ type?: string; entityId?: string; quantity?: number }>;
    },
  ): Promise<void> {
    const raw = (store as { dailyMenuByWeekday?: unknown }).dailyMenuByWeekday;
    const storeId = this.stringifyIdLike((store as { _id?: unknown })._id);
    const dailyMenuLimit = Types.ObjectId.isValid(storeId)
      ? await this._subscriptionsService.resolveDailyMenuItemLimitForStore(
          storeId,
        )
      : null;
    const rows = this.normalizeDailyMenuForApi(
      Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [],
      dailyMenuLimit,
    );
    const slot = this.todayDailyMenuSlot(rows);
    if (!slot) {
      return;
    }
    for (const line of cart.items) {
      if (line.type !== CartItemTypeEnum.PRODUCT) continue;
      const pid = String(line.entityId ?? '');
      if (!pid) continue;
      const entry = slot.items.find((i) => i.productId === pid);
      if (!entry) {
        throw new BadRequestException('daily_menu_product_not_available');
      }
      if (!entry.stockUnlimited && entry.stockRemaining <= 0) {
        throw new BadRequestException('daily_menu_product_not_available');
      }
      if (entry.stockUnlimited) continue;
      const qty = Math.max(0, Number(line.quantity ?? 0));
      if (qty > entry.stockRemaining) {
        throw new BadRequestException('daily_menu_insufficient_stock');
      }
    }
  }

  /**
   * Centre de notifications : `vendorMessages` des boutiques accessibles (propriétaire + équipe),
   * plus l’historique fidélité `rewardHistory` du document user.
   */
  async findMyNotificationFeed(user: UserModel) {
    const uid = user._id;
    const access = await this._storeAccess.resolveStoreAccess(user);
    const storeIds = [
      ...new Set(
        access
          .map((a) => a.storeId)
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ].map((id) => new Types.ObjectId(id));
    const stores =
      storeIds.length > 0
        ? await this._storeModel
            .find({ _id: { $in: storeIds } })
            .select('name vendorMessages')
            .lean()
            .exec()
        : [];

    type FeedItem = {
      id: string;
      source: 'store' | 'user';
      message: string;
      from: string;
      createdAt: string;
      storeName?: string;
      storeId?: string;
    };

    const items: FeedItem[] = [];

    for (const st of stores) {
      const sid = String(st._id);
      const name = String(st.name ?? '');
      const raw =
        (
          st as {
            vendorMessages?: Array<{
              _id?: { toString(): string };
              message?: string;
              from?: string;
              createdAt?: Date;
            }>;
          }
        ).vendorMessages ?? [];
      for (const m of raw) {
        const mid =
          m._id != null
            ? m._id.toString()
            : `${sid}-${String(m.createdAt)}-${(m.message ?? '').slice(0, 12)}`;
        const created =
          m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : String(m.createdAt ?? new Date().toISOString());
        items.push({
          id: `store:${sid}:${mid}`,
          source: 'store',
          storeName: name,
          storeId: sid,
          message: String(m.message ?? ''),
          from: String(m.from ?? 'SYSTEM'),
          createdAt: created,
        });
      }
    }

    const udoc = await this._userModel
      .findById(uid)
      .select('rewardHistory')
      .lean()
      .exec();

    const rewards =
      (
        udoc as {
          rewardHistory?: Array<{
            points: number;
            reason: string;
            createdAt?: Date;
          }>;
        } | null
      )?.rewardHistory ?? [];

    for (const r of rewards) {
      const pts = Number(r.points ?? 0);
      const sign = pts > 0 ? '+' : '';
      const abs = Math.abs(pts);
      items.push({
        id: `user:reward:${String(r.createdAt ?? '')}:${String(
          r.reason ?? '',
        ).slice(0, 24)}`,
        source: 'user',
        message: `${sign}${pts} point${
          abs !== 1 ? 's' : ''
        } fidélité — ${String(r.reason ?? '')}`,
        from: 'FIDÉLITÉ',
        createdAt:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : String(r.createdAt ?? new Date().toISOString()),
      });
    }

    items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return { items };
  }

  /** Fil notifications vendeur pour un userId (appels internes WS → push temps réel). */
  async findNotificationFeedByUserId(userId: string) {
    const uid = userId?.trim();
    if (!uid) return { items: [] };
    const user = await this._usersService.findById(uid);
    if (!user) return { items: [] };
    return this.findMyNotificationFeed(user);
  }

  /** Mise à jour fiche vendeur (dossier en PENDING ou REVISION). */
  async updateVendorApplication(user: UserModel, args: CreateStoreDto) {
    await this._businessTypesService.assertActiveSlug(args.businessType);
    const fullUser = await this._usersService.findById(
      (user._id as { toString(): string }).toString(),
    );
    await this._supportedCountries.assertVendorApplicationCompatible(
      fullUser,
      args,
    );
    const storeRegion = this._resolveStoreRegion(args);
    const derivedCurrency = await this._resolveCurrencyForCountryCode(
      storeRegion,
    );
    this._assertVendorShopAddressForOnboarding(args.address);
    const store = await this._storeModel
      .findOne({ owner: user._id })
      .populate('address')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (
      ![StoreStatusEnum.PENDING, StoreStatusEnum.REVISION].includes(
        store.status,
      )
    ) {
      throw new ForbiddenException('store_not_editable');
    }
    const dup = await this._storeModel
      .findOne({ name: args.name, _id: { $ne: store._id } })
      .exec();
    if (dup) {
      throw new ConflictException('store_already_exists');
    }
    const addrDoc = store.address as AddressModel & {
      _id: { toString(): string };
    };
    const addrId = addrDoc._id.toString();
    await this._addressesService.patchById(addrId, {
      ...args.address,
      latitude: args.address.latitude,
      longitude: args.address.longitude,
    });

    const wasRevision = store.status === StoreStatusEnum.REVISION;
    const shippingZones = args.supportsShipping
      ? args.shippingZones ?? store.shippingZones ?? []
      : [];

    const deliveryDriverSettings = this._normalizeVendorDeliveryDriverSettings(
      args,
    );
    const wantsPreOrders = this._normalizeMealPreOrdersFlag(
      args.acceptsMealPreOrders,
    );
    await this._assertMealPreOrdersAllowedForStore(
      (store._id as { toString(): string }).toString(),
      wantsPreOrders,
    );
    const setFields: Record<string, unknown> = {
      name: args.name,
      bio: args.bio,
      email: args.email,
      phoneNumber: args.phoneNumber,
      region: storeRegion,
      currency: derivedCurrency,
      supportsShipping: args.supportsShipping,
      shippingZones,
      acceptsMealPreOrders: wantsPreOrders,
      mealPreOrderCatalogScope: this._normalizeMealPreOrderCatalogScope(
        args.mealPreOrderCatalogScope,
      ),
      vendorManagesDeliveryDrivers:
        deliveryDriverSettings.vendorManagesDeliveryDrivers,
      deliveryAssignmentMode: deliveryDriverSettings.deliveryAssignmentMode,
      ...(wasRevision && { status: StoreStatusEnum.PENDING }),
    };
    const updateDoc: Record<string, unknown> = { $set: setFields };
    if (args.businessType) {
      setFields.businessType = args.businessType;
    } else {
      updateDoc.$unset = { businessType: 1 };
    }

    await this._storeModel.updateOne({ _id: store._id }, updateDoc);

    await this._storeModel.updateOne(
      { _id: store._id },
      {
        $push: {
          vendorMessages: {
            message: wasRevision
              ? 'Fiche corrigée. Votre dossier est à nouveau en examen.'
              : 'Informations établissement mises à jour.',
            from: 'SYSTEM',
            createdAt: new Date(),
          },
        },
      },
    );

    this._wsInboxNotify.notifyUserInboxRefresh(
      (user._id as { toString(): string }).toString(),
    );

    await this._invalidatePublicCatalogCachesForStore(
      (store._id as { toString(): string }).toString(),
    );

    return this.findMyStoreSummary(user);
  }

  /**
   * Enregistre `supportsShipping` et `shippingZones` sans repasser par la fiche complète
   * (nécessaire pour les boutiques ACTIVE, car `updateVendorApplication` est réservé au dossier).
   */
  async updateVendorShippingZones(
    user: UserModel,
    args: PatchVendorShippingZonesDto,
    storeId?: string,
  ) {
    const access = await this._storeAccess.resolveStoreAccess(user);
    const requested = storeId?.trim();
    let targetId = requested;
    if (!targetId) {
      const owned =
        access.find((a) => a.isOwner)?.storeId ?? access[0]?.storeId;
      targetId = owned;
    }
    if (!targetId) {
      throw new NotFoundException('store_not_found');
    }
    const row = access.find((a) => a.storeId === targetId);
    if (!row) {
      throw new ForbiddenException('store_not_found');
    }

    const store = await this._storeModel.findById(targetId).exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (store.status === StoreStatusEnum.INACTIVE) {
      throw new ForbiddenException('store_not_editable');
    }
    const shippingZones = args.supportsShipping ? args.shippingZones ?? [] : [];
    if (args.supportsShipping && shippingZones.length > 0) {
      for (const z of shippingZones) {
        if (z.minDistance > z.maxDistance) {
          throw new BadRequestException('invalid_shipping_zone_distances');
        }
      }
    }
    const deliveryDriverSettings = this._normalizeVendorDeliveryDriverSettings(
      args,
    );
    const wantsPreOrders =
      args.acceptsMealPreOrders !== undefined
        ? this._normalizeMealPreOrdersFlag(args.acceptsMealPreOrders)
        : undefined;
    if (wantsPreOrders === true) {
      await this._assertMealPreOrdersAllowedForStore(targetId, true);
    }
    const updateFields: Record<string, unknown> = {
      supportsShipping: args.supportsShipping,
      shippingZones,
      vendorManagesDeliveryDrivers:
        deliveryDriverSettings.vendorManagesDeliveryDrivers,
      deliveryAssignmentMode: deliveryDriverSettings.deliveryAssignmentMode,
    };
    if (wantsPreOrders !== undefined) {
      updateFields.acceptsMealPreOrders = wantsPreOrders;
    }
    if (args.mealPreOrderCatalogScope !== undefined) {
      updateFields.mealPreOrderCatalogScope =
        this._normalizeMealPreOrderCatalogScope(args.mealPreOrderCatalogScope);
    }
    await this._storeModel.updateOne(
      { _id: store._id },
      { $set: updateFields },
    );
    await this._storeModel.updateOne(
      { _id: store._id },
      {
        $push: {
          vendorMessages: {
            message:
              wantsPreOrders !== undefined
                ? 'Préférences commandes et livraison enregistrées.'
                : 'Préférence de livraison enregistrée.',
            from: 'SYSTEM',
            createdAt: new Date(),
          },
        },
      },
    );
    this._wsInboxNotify.notifyUserInboxRefresh(
      (user._id as { toString(): string }).toString(),
    );
    await this._invalidatePublicCatalogCachesForStore(targetId);
    return this.findMyStoreSummary(user, targetId);
  }

  async updateProfileImage(
    id: string,
    file: Express.Multer.File,
    user: UserModel,
  ) {
    let url: string | undefined;
    try {
      await this._storeAccess.assertStoreAccess(user, id, 'settings.edit');

      const store = await this._storeModel.findById(id).exec();
      if (!store) {
        throw new BadRequestException('store_not_found');
      }

      url = await this._mediasService.upload(
        file,
        user,
        `stores/${id}/profile`,
      );
      if (!url) {
        throw new BadRequestException('image_upload_failed');
      }

      if (store.profileImage) {
        await this._mediasService.delete(store.profileImage);
      }

      await this._storeModel
        .updateOne({ _id: id }, { profileImage: url })
        .exec();
      return { url };
    } catch (e) {
      if (url) {
        await this._mediasService.delete(url);
      }
      throw e;
    }
  }

  async listStoreProducts(storeId: string, user: UserModel) {
    await this.assertVendorCatalogStoreAccess(storeId, user);
    const rows = await this._productsService.findByStoreId(storeId);
    const allowed = await this.accessibleProductIdsForStore(storeId);
    if (allowed == null) return rows;
    return rows.filter((p) =>
      allowed.has(String((p as { id?: unknown }).id ?? '')),
    );
  }

  private async assertVendorCatalogStoreAccess(
    storeId: string,
    user: UserModel,
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, 'catalog.view');
  }

  private async accessibleProductIdsForStore(
    storeId: string,
  ): Promise<Set<string> | null> {
    const resolved =
      await this._subscriptionsService.resolveAccessibleCatalogIdsForStore(
        storeId,
      );
    return resolved.limit == null ? null : resolved.productIds;
  }

  /** Plats catalogue vendeur (food ou menu du jour du jour courant). */
  async listVendorCatalogProducts(
    storeId: string,
    user: UserModel,
    args: {
      page: number;
      take: number;
      q?: string;
      tab: 'food' | 'daily_menu';
    },
  ) {
    await this.assertVendorCatalogStoreAccess(storeId, user);
    let productIds: string[] | undefined;
    const dailyMenuByProductId = new Map<
      string,
      {
        stockUnlimited: boolean;
        stockRemaining: number;
        soldOut: boolean;
      }
    >();
    if (args.tab === 'daily_menu') {
      const doc = await this._storeModel
        .findById(storeId)
        .select('dailyMenuByWeekday')
        .lean()
        .exec();
      const dailyMenuLimit =
        await this._subscriptionsService.resolveDailyMenuItemLimitForStore(
          storeId,
        );
      const rows = this.normalizeDailyMenuForApi(
        (doc?.dailyMenuByWeekday as Record<string, unknown>[]) ?? [],
        dailyMenuLimit,
      );
      const dayOfWeek = new Date().getDay();
      const slot = rows.find((r) => r.dayOfWeek === dayOfWeek);
      for (const it of slot?.items ?? []) {
        dailyMenuByProductId.set(it.productId, {
          stockUnlimited: it.stockUnlimited,
          stockRemaining: it.stockRemaining,
          soldOut: it.soldOut,
        });
      }
      productIds = [...dailyMenuByProductId.keys()];
    }
    const allowed = await this.accessibleProductIdsForStore(storeId);
    const scopedProductIds =
      productIds != null
        ? allowed == null
          ? productIds
          : productIds.filter((pid) => allowed.has(pid))
        : allowed == null
        ? undefined
        : [...allowed];
    const page = await this._productsService.findByStoreIdPaginated(storeId, {
      page: args.page,
      take: args.take,
      q: args.q,
      productIds: scopedProductIds,
    });
    if (args.tab !== 'daily_menu' || !dailyMenuByProductId.size) {
      return page;
    }
    return {
      ...page,
      items: page.items.map((p) => {
        const dm = dailyMenuByProductId.get(p.id);
        return dm
          ? {
              ...p,
              dailyMenu: {
                stockUnlimited: dm.stockUnlimited,
                stockRemaining: dm.stockRemaining,
                soldOut: dm.soldOut,
              },
            }
          : p;
      }),
    };
  }

  async getStoreProductForOwner(
    storeId: string,
    productId: string,
    user: UserModel,
  ) {
    await this.assertVendorCatalogStoreAccess(storeId, user);
    const isAllowed =
      await this._subscriptionsService.isCatalogItemAccessibleForStore(
        storeId,
        productId,
        'product',
      );
    if (!isAllowed) {
      throw new ForbiddenException('catalog_item_locked_by_plan_limit');
    }
    return this._productsService.findOneForStoreOwner(storeId, productId);
  }

  async updateStoreProduct(
    storeId: string,
    productId: string,
    args: PatchProductDto,
    user: UserModel,
    image?: Express.Multer.File,
    gallery?: Express.Multer.File[],
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, 'catalog.edit');
    const isAllowed =
      await this._subscriptionsService.isCatalogItemAccessibleForStore(
        storeId,
        productId,
        'product',
      );
    if (!isAllowed) {
      throw new ForbiddenException('catalog_item_locked_by_plan_limit');
    }
    const store = await this._storeModel.findById(storeId).exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }
    return this._productsService.updateForVendor(
      productId,
      storeId,
      args,
      user,
      store,
      image,
      gallery,
    );
  }

  async deleteStoreProduct(
    storeId: string,
    productId: string,
    user: UserModel,
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, 'catalog.edit');
    const isAllowed =
      await this._subscriptionsService.isCatalogItemAccessibleForStore(
        storeId,
        productId,
        'product',
      );
    if (!isAllowed) {
      throw new ForbiddenException('catalog_item_locked_by_plan_limit');
    }
    const store = await this._storeModel.findById(storeId).exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }
    await this._productsService.deleteForVendor(productId, storeId);
  }

  async createProduct(
    id: string,
    args: CreateProductDto,
    user: UserModel,
    image?: Express.Multer.File,
    gallery?: Express.Multer.File[],
  ) {
    await this._storeAccess.assertStoreAccess(user, id, 'catalog.edit');
    const store = await this._storeModel
      .findById(id)
      .populate('address')
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    const catalogLimit =
      await this._subscriptionsService.resolveCatalogItemLimitForStore(id);
    if (catalogLimit != null) {
      const [foods, drinks] = await Promise.all([
        this._productModel.countDocuments({ store: id }).exec(),
        this._drinksService.countByStoreId(id),
      ]);
      if (foods + drinks >= catalogLimit) {
        throw new ForbiddenException('catalog_limit_reached_for_plan');
      }
    }

    const exists = await this._productsService.existsInStore(
      args.title,
      store._id.toString(),
    );

    if (exists) {
      throw new ConflictException('product_already_exists');
    }

    const product = await this._productsService.create(
      args,
      user,
      store,
      image,
      gallery,
    );
    return this._productsService.findOneById(product._id.toString());
  }

  async createProducExtra(
    productId: string,
    storeId: string,
    args: CreateProductExtraDto,
    user: UserModel,
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, 'catalog.edit');
    const isAllowed =
      await this._subscriptionsService.isCatalogItemAccessibleForStore(
        storeId,
        productId,
        'product',
      );
    if (!isAllowed) {
      throw new ForbiddenException('catalog_item_locked_by_plan_limit');
    }
    const store = await this._storeModel.findById(storeId).exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    const product = await this._productsService.findOneById(productId);

    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    let url;

    try {
      if (args.image) {
        url = await this._mediasService.upload(
          args.image,
          user,
          `stores/${storeId}/extras/${productId}`,
        );
        if (!url) {
          throw new BadRequestException('image_upload_failed');
        }
        args.profileImage = url;
      }
      const extra = await this._productsService.createExtra(
        args,
        product,
        store,
        user,
      );

      return this._productsService.findOneById(productId);
    } catch (e) {
      if (url) {
        await this._mediasService.delete(url);
      }
      throw e;
    }
  }

  async deleteProductExtra(
    storeId: string,
    productId: string,
    extraId: string,
    user: UserModel,
  ) {
    await this._storeAccess.assertStoreAccess(user, storeId, 'catalog.edit');
    const isAllowed =
      await this._subscriptionsService.isCatalogItemAccessibleForStore(
        storeId,
        productId,
        'product',
      );
    if (!isAllowed) {
      throw new ForbiddenException('catalog_item_locked_by_plan_limit');
    }
    const product = await this._productsService.findOneById(productId);
    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    if (product.store.id !== storeId) {
      throw new ForbiddenException('unauthorized_action');
    }

    const isValidExtra = product.extras.find(
      (extra) => extra._id.toString() === extraId,
    );
    // console.log('🚀 ~ StoreService ~ isValidExtra:', isValidExtra);
    // console.log('🚀 ~ StoreService ~ product.extras:', product.extras);

    if (!isValidExtra) {
      throw new NotFoundException('extra_not_found');
    }

    const isExtraUsedInOffer =
      await this._offersService.isProductExtraUsedInOffer(
        productId,
        extraId,
        user,
      );

    if (isExtraUsedInOffer) {
      throw new ForbiddenException('extra_used_in_offer');
    }

    await this._productsService.deleteExtra(productId, extraId, user);
    await this._cartService.removeBy({
      type: CartItemTypeEnum.PRODUCT_EXTRA,
      itemId: extraId,
    });
    return this._productsService.findOneById(productId);
  }

  async createRating(id: string, args: CreateRatingDto, user: UserModel) {
    const store = await this._storeModel
      .findOne({ _id: id })
      // .populate('ratings')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    try {
      const rating = await this._ratingsService.createStoreRating(
        args,
        store,
        user,
      );

      if (rating) {
        await this._storeModel
          .updateOne(
            { _id: store._id },
            {
              $push: {
                ratings: rating._id,
              },
            },
            {
              new: true,
              upsert: true,
            },
          )
          .exec();
      }
      return this.findOneById(store._id.toString());
    } catch (e) {
      console.log('🚀 ~ StoreService ~ createRating ~ e:', e);
      throw new BadRequestException('error_creating_rating');
    }
  }

  async addToFavorites(storeId: string, user: UserModel) {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new NotFoundException('store_not_found');
    }
    const store = await this._storeModel.findOne({ _id: storeId }).exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    await this._storeModel
      .updateOne(
        { _id: storeId },
        {
          $addToSet: {
            likedBy: user._id,
          },
        },
      )
      .exec();
    return this.findOneById(storeId);
  }

  async removeFromFavorites(storeId: string, user: UserModel) {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new NotFoundException('store_not_found');
    }
    const store = await this._storeModel.findOne({ _id: storeId }).exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    await this._storeModel
      .updateOne(
        { _id: storeId },
        {
          $pull: {
            likedBy: user._id,
          },
        },
      )
      .exec();
    return this.findOneById(storeId);
  }

  async createOffer(
    id: string,
    args: CreateOfferDto,
    user: UserModel,
  ): Promise<any> {
    const store = await this._storeModel
      .findOne({ _id: id, owner: user._id })
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    let url: string;

    try {
      if (args.image) {
        url = await this._mediasService.upload(
          args.image,
          user,
          `stores/${id}/offers`,
        );
        if (!url) {
          throw new BadRequestException('image_upload_failed');
        }
        args.profileImage = url;
      }

      const offer = await this._offersService.create(args, store, user);
      return this._offersService.findOne(offer._id.toString(), user);
    } catch (e) {
      if (url) {
        await this._mediasService.delete(url);
      }
      throw e;
    }
  }

  async addItemToStoreCart(
    id: string,
    args: AddItemToCartDto,
    user: UserModel,
  ) {
    const store = await this._storeModel
      .findOne({ _id: id })
      .populate('owner')
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    // Règle produit: en mode client, tous les rôles peuvent commander
    // (CUSTOMER / VENDOR / ADMIN / DELIVERY), y compris le propriétaire.
    await this.assertDailyMenuProductAddAllowed(id, user, args);

    return await this._cartService.addItemToCart(args, user, store);
  }

  async createOrderFromCart(storeId: string, user: UserModel) {
    const store = await this.findOneById(storeId);

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.acceptsOrders) {
      throw new ForbiddenException('store_does_not_accept_orders');
    }

    let cart;
    try {
      cart = await this._cartService.findOneByStoreId(storeId, user);
    } catch {
      throw new NotFoundException('cart_is_empty');
    }
    if (!cart?.items?.length) {
      throw new NotFoundException('cart_is_empty');
    }

    await this.assertDailyMenuStockForCart(store, cart);

    const dow = new Date().getDay();
    const consumed: { productId: string; qty: number }[] = [];
    const consumedDrinks: { drinkId: string; qty: number }[] = [];

    const drinkQty = new Map<string, number>();
    for (const line of cart.items) {
      if (line.type !== CartItemTypeEnum.DRINK) continue;
      const did = String(line.entityId ?? '');
      if (!did) continue;
      const q = Math.max(0, Number(line.quantity ?? 0));
      if (q <= 0) continue;
      drinkQty.set(did, (drinkQty.get(did) ?? 0) + q);
    }

    const rollbackDrinks = async () => {
      for (let i = consumedDrinks.length - 1; i >= 0; i--) {
        const c = consumedDrinks[i]!;
        await this._drinksService
          .restoreStock(storeId, c.drinkId, c.qty)
          .catch(() => undefined);
      }
    };

    try {
      for (const [did, qty] of drinkQty) {
        const drink = await this._drinksService.findOneInStoreByIdRaw(
          storeId,
          did,
        );
        const maxOrder = drink ? maxDrinkOrderQuantity(drink.quantite) : 0;
        if (!drink || qty > maxOrder) {
          await rollbackDrinks();
          throw new BadRequestException('drink_quantity_limit_exceeded');
        }
        const ok = await this._drinksService.tryConsumeStock(storeId, did, qty);
        if (!ok) {
          await rollbackDrinks();
          throw new BadRequestException('drink_insufficient_stock');
        }
        consumedDrinks.push({ drinkId: did, qty });
      }

      for (const line of cart.items) {
        if (line.type !== CartItemTypeEnum.PRODUCT) continue;
        const pid = String(line.entityId ?? '');
        const qty = Math.max(0, Number(line.quantity ?? 0));
        if (qty <= 0 || !pid) continue;
        const r = await this.tryConsumeDailyMenuStock(storeId, dow, pid, qty);
        if (r === 'fail') {
          throw new BadRequestException('daily_menu_insufficient_stock');
        }
        if (r === 'ok') {
          consumed.push({ productId: pid, qty });
        }
      }

      const order = await this._ordersService.createFromCart(storeId, user);

      if (order) {
        await this._cartService.clearStoreCart(store, user);
      }

      return order;
    } catch (e) {
      await rollbackDrinks();
      for (const c of consumed.reverse()) {
        await this.atomicIncrementDailyMenuProductStock(
          storeId,
          dow,
          c.productId,
          c.qty,
        ).catch(() => undefined);
      }
      throw e;
    }
  }

  /** Liste des boutiques (admin) — pour tableau vendeurs. */
  async listVendorStoresForAdmin(admin: UserModel) {
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    const rows = await this._storeModel
      .find({})
      .populate({
        path: 'owner',
        select:
          'fullName email stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      })
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode location',
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    const storeIds = (rows as Record<string, unknown>[]).map((s) =>
      String(s._id),
    );
    const planByStore = await this._resolveSubscriptionPlanByStoreIds(storeIds);

    return (rows as Record<string, unknown>[]).map((s) =>
      this._mapStoreToAdminVendorRow(s, {
        subscriptionPlan: planByStore.get(String(s._id)),
      }),
    );
  }

  private _mapStoreToAdminVendorRow(
    s: Record<string, unknown>,
    options?: { subscriptionPlan?: string },
  ) {
    const owner = s.owner as Record<string, unknown> | undefined;
    const fullName = owner
      ? String(owner.fullName ?? owner.full_name ?? '').trim()
      : '';
    const parts = fullName.split(/\s+/).filter(Boolean);
    const ownerPrenom = parts.length > 1 ? parts[0] : '';
    const ownerNom =
      parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '';

    const addr = s.address as Record<string, unknown> | undefined;
    let adresse = '';
    if (addr) {
      const line = String(addr.address ?? '');
      const city = String(addr.city ?? '');
      adresse = city ? `${line}, ${city}` : line;
    }

    let latitude: number | null = null;
    let longitude: number | null = null;
    const loc = addr?.location as { coordinates?: number[] } | undefined;
    const coords = loc?.coordinates;
    if (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      !(Number(coords[0]) === 0 && Number(coords[1]) === 0)
    ) {
      longitude = Number(coords[0]);
      latitude = Number(coords[1]);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        latitude = null;
        longitude = null;
      }
    }

    const createdRaw = s.createdAt ?? s.created_at;
    const updatedRaw = s.updatedAt ?? s.updated_at;
    const toIso = (raw: unknown) => {
      if (raw instanceof Date) return raw.toISOString();
      if (typeof raw === 'string' && raw.length)
        return new Date(raw).toISOString();
      return undefined;
    };
    const stripeOnboardingStatus = resolveStripeOnboardingStatusLabel(owner);
    const partnerBadgeCode = String(
      s.partnerBadgeCode ?? s.partner_badge_code ?? '',
    ).trim();

    return {
      id: String(s._id),
      name: String(s.name ?? ''),
      email: String(s.email ?? ''),
      phoneNumber: String(s.phoneNumber ?? s.phone_number ?? ''),
      status: String(s.status ?? StoreStatusEnum.PENDING),
      currency: String(s.currency ?? 'CAD'),
      ownerFullName: fullName,
      ownerNom,
      ownerPrenom,
      adresse,
      latitude,
      longitude,
      stripeOnboardingStatus,
      partnerBadge: serializePartnerBadge(partnerBadgeCode || null),
      subscriptionPlan:
        String(options?.subscriptionPlan ?? '').trim() || 'FREE',
      createdAt: toIso(createdRaw),
      updatedAt: toIso(updatedRaw),
    };
  }

  /** Attribue un badge partenaire à une boutique active (admin). */
  async setVendorStorePartnerBadgeForAdmin(
    storeId: string,
    admin: UserModel,
    badgeCode: string | null | undefined,
  ) {
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    if (!Types.ObjectId.isValid(storeId)) {
      throw new NotFoundException('store_not_found');
    }

    if (badgeCode != null && badgeCode !== '') {
      const raw = String(badgeCode).trim().toUpperCase();
      if (!isPartnerBadgeCode(raw)) {
        throw new BadRequestException('invalid_partner_badge');
      }
    }
    const normalizedBadge = resolveEffectivePartnerBadgeCode(
      badgeCode == null || badgeCode === '' ? null : badgeCode,
    );

    const store = await this._storeModel
      .findById(storeId)
      .populate({
        path: 'owner',
        select:
          'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      })
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (store.status !== StoreStatusEnum.ACTIVE) {
      throw new BadRequestException('vendor_store_not_active');
    }

    const previousBadge = resolveEffectivePartnerBadgeCode(store.partnerBadgeCode);
    const ownerId = (() => {
      const o = store.owner as UserModel | undefined;
      if (o?._id) return String(o._id);
      if (store.owner) return String(store.owner);
      return '';
    })();

    store.partnerBadgeCode = normalizedBadge;
    await store.save();

    const owner = store.owner as UserModel | undefined;
    const connectAccountId = String(owner?.stripeConnectAccountId ?? '').trim();
    if (connectAccountId) {
      await this._stripeConnect.applyPartnerBadgePayoutSchedule(
        connectAccountId,
        normalizedBadge,
      );
    }

    if (ownerId) {
      void this._vendorStatusEmail
        .notifyPartnerBadgeChanged({
          recipientRole: 'vendor',
          userId: ownerId,
          storeId,
          storeName: String(store.name ?? '').trim(),
          previousBadgeCode: previousBadge,
          newBadgeCode: normalizedBadge,
        })
        .catch((e) =>
          this._logger.warn(
            `partner_badge_email_failed store=${storeId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        );
    }

    const planByStore = await this._resolveSubscriptionPlanByStoreIds([storeId]);
    return this._mapStoreToAdminVendorRow(
      store.toObject() as Record<string, unknown>,
      { subscriptionPlan: planByStore.get(storeId) },
    );
  }

  private async _resolveSubscriptionPlanByStoreIds(
    storeIds: string[],
  ): Promise<Map<string, string>> {
    const validOids = storeIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!validOids.length) return new Map();

    const rows = await this._vendorSubscriptionModel
      .find({
        store: { $in: validOids },
        status: 'ACTIVE',
      })
      .select('store planName endsAt createdAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const nowMs = Date.now();
    const byStore = new Map<
      string,
      { planName: string; endsAtMs: number; createdAtMs: number }
    >();

    const toMs = (raw: unknown): number => {
      const t =
        raw instanceof Date
          ? raw.getTime()
          : new Date(String(raw ?? '')).getTime();
      return Number.isFinite(t) ? t : Number.MIN_SAFE_INTEGER;
    };

    for (const row of rows as Record<string, unknown>[]) {
      const storeId = String(row.store ?? '');
      if (!storeId) continue;
      const planName = String(row.planName ?? '').trim();
      if (!planName) continue;
      const endsAtMs = toMs(row.endsAt);
      const createdAtMs = toMs(row.createdAt);
      const existing = byStore.get(storeId);
      if (!existing) {
        byStore.set(storeId, { planName, endsAtMs, createdAtMs });
        continue;
      }
      const existingValid = existing.endsAtMs > nowMs;
      const currentValid = endsAtMs > nowMs;
      if (currentValid && !existingValid) {
        byStore.set(storeId, { planName, endsAtMs, createdAtMs });
        continue;
      }
      if (
        currentValid === existingValid &&
        createdAtMs > existing.createdAtMs
      ) {
        byStore.set(storeId, { planName, endsAtMs, createdAtMs });
      }
    }

    const out = new Map<string, string>();
    for (const [storeId, value] of byStore.entries()) {
      out.set(storeId, value.planName);
    }
    return out;
  }

  private _resolveStripeOnboardingStatus(
    owner?: Record<string, unknown>,
  ): 'COMPLETE' | 'ACTION_REQUIRED' | 'IN_PROGRESS' | 'NOT_STARTED' {
    const accountId = String(owner?.stripeConnectAccountId ?? '').trim();
    if (!accountId) return 'NOT_STARTED';

    const chargesEnabled = Boolean(owner?.stripeConnectChargesEnabled);
    const payoutsEnabled = Boolean(owner?.stripeConnectPayoutsEnabled);
    const detailsSubmitted = Boolean(owner?.stripeConnectDetailsSubmitted);
    const disabledReason = String(
      owner?.stripeConnectDisabledReason ?? '',
    ).trim();
    const currentlyDue = Array.isArray(owner?.stripeConnectRequirementsDue)
      ? owner?.stripeConnectRequirementsDue
      : [];
    const pastDue = Array.isArray(owner?.stripeConnectRequirementsPastDue)
      ? owner?.stripeConnectRequirementsPastDue
      : [];

    if (disabledReason || pastDue.length > 0) return 'ACTION_REQUIRED';
    if (
      chargesEnabled &&
      payoutsEnabled &&
      detailsSubmitted &&
      currentlyDue.length === 0
    ) {
      return 'COMPLETE';
    }
    return 'IN_PROGRESS';
  }

  /** Approuver (ACTIVE) ou suspendre (INACTIVE) une boutique. */
  async setVendorStoreStatusForAdmin(
    storeId: string,
    status: StoreStatusEnum.ACTIVE | StoreStatusEnum.INACTIVE,
    admin: UserModel,
  ) {
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    const doc = await this._storeModel.findById(storeId).exec();
    if (!doc) {
      throw new NotFoundException('store_not_found');
    }
    const previousStatus = doc.status;
    const emailNotification: {
      attempted: boolean;
      sent: boolean;
      error?: string;
    } = {
      attempted: false,
      sent: false,
    };
    doc.status = status;
    if (status === StoreStatusEnum.INACTIVE) {
      doc.acceptsOrders = false;
      doc.canCreateProducts = false;
    } else {
      doc.acceptsOrders = true;
      doc.canCreateProducts = true;
      if (!String(doc.partnerBadgeCode ?? '').trim()) {
        doc.partnerBadgeCode = PartnerBadgeCode.SILVER;
      }
    }

    if (previousStatus !== status) {
      const statusLabel =
        status === StoreStatusEnum.ACTIVE ? 'actif' : 'inactif';
      doc.vendorMessages = [
        ...(doc.vendorMessages || []),
        {
          message: `Le statut de votre restaurant a changé : ${statusLabel}.`,
          from: 'ADMIN',
          createdAt: new Date(),
        },
      ];
      this._dashboardAudit.recordPlatformEvent(admin, {
        action: 'ADMIN_VENDOR_STORE_STATUS_CHANGED',
        category: 'vendors',
        path: `/vendeurs/${storeId}`,
        storeId,
        resource: 'vendor_store',
        resourceId: storeId,
        metadata: {
          storeName: doc.name,
          previousStatus,
          newStatus: status,
        },
      });
      const ownerId = (() => {
        const o = doc.owner as unknown;
        if (o && typeof o === 'object' && '_id' in o) {
          return String((o as { _id: { toString(): string } })._id);
        }
        if (
          o != null &&
          typeof (o as { toString?: () => string }).toString === 'function'
        ) {
          return String(o);
        }
        return '';
      })();
      if (ownerId) {
        emailNotification.attempted = true;
        try {
          await this._sendVendorStoreStatusUpdatedEmail(ownerId, doc, status);
          emailNotification.sent = true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          emailNotification.error = msg;
          this._logger.warn(
            `status_update_email_failed store=${storeId} owner=${ownerId} ${msg}`,
          );
        }
      }
    }
    await doc.save();

    if (status === StoreStatusEnum.ACTIVE) {
      const ownerOid = (() => {
        const o = doc.owner as unknown;
        if (o && typeof o === 'object' && '_id' in o) {
          return String((o as { _id: { toString(): string } })._id);
        }
        if (
          o != null &&
          typeof (o as { toString?: () => string }).toString === 'function'
        ) {
          return String(o);
        }
        return '';
      })();
      if (ownerOid && Types.ObjectId.isValid(ownerOid)) {
        const owner = await this._userModel.findById(ownerOid).exec();
        if (owner?.stripeConnectAccountId?.trim()) {
          await this._stripeConnect.ensurePartnerBadgePayoutScheduleForUser(
            owner,
          );
        }
      }
    }

    if (
      status === StoreStatusEnum.ACTIVE &&
      previousStatus !== StoreStatusEnum.ACTIVE
    ) {
      this._sitemapDispatch.requestRegenerate('store_activated');
    }

    const ownerIdForWs = (() => {
      const o = doc.owner as unknown;
      if (o && typeof o === 'object' && '_id' in o) {
        return String((o as { _id: { toString(): string } })._id);
      }
      if (
        o != null &&
        typeof (o as { toString?: () => string }).toString === 'function'
      ) {
        return String(o);
      }
      return '';
    })();
    if (ownerIdForWs) {
      this._wsInboxNotify.notifyUserInboxRefresh(ownerIdForWs);
    }

    const lean = await this._storeModel
      .findById(storeId)
      .populate({
        path: 'owner',
        select:
          'fullName email stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      })
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode',
      })
      .lean()
      .exec();
    const planByStore = await this._resolveSubscriptionPlanByStoreIds([
      storeId,
    ]);
    return {
      store: this._mapStoreToAdminVendorRow(lean as Record<string, unknown>, {
        subscriptionPlan: planByStore.get(storeId),
      }),
      emailNotification,
    };
  }

  private async _assertAdminVendorPermission(admin: UserModel): Promise<void> {
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this._storeAccess.assertAdminPermission(admin, 'admin.vendors');
  }

  private _adminVendorProfileSnapshot(
    doc: Record<string, unknown>,
    addr?: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const loc = addr?.location as { coordinates?: number[] } | undefined;
    const coords = loc?.coordinates ?? [0, 0];
    const zones = (doc.shippingZones as Record<string, unknown>[]) ?? [];
    return {
      name: String(doc.name ?? ''),
      bio: String(doc.bio ?? ''),
      businessType: doc.businessType ? String(doc.businessType) : null,
      email: String(doc.email ?? ''),
      phoneNumber: String(doc.phoneNumber ?? doc.phone_number ?? ''),
      currency: String(doc.currency ?? 'CAD'),
      region: String(doc.region ?? addr?.countryCode ?? '')
        .trim()
        .toUpperCase(),
      supportsShipping: !!doc.supportsShipping,
      acceptsOrders: doc.acceptsOrders !== false,
      acceptsMealPreOrders: this._docAcceptsMealPreOrders(
        doc as Record<string, unknown>,
      ),
      mealPreOrderCatalogScope: this._docMealPreOrderCatalogScope(
        doc as Record<string, unknown>,
      ),
      vendorManagesDeliveryDrivers: !!doc.vendorManagesDeliveryDrivers,
      deliveryAssignmentMode: String(
        doc.deliveryAssignmentMode ?? 'AUTO',
      ).toUpperCase(),
      shippingZones: zones.map((z) => ({
        minDistance: Number(z.minDistance ?? 0),
        maxDistance: Number(z.maxDistance ?? 0),
        price: Number(z.price ?? 0),
      })),
      address: {
        address: String(addr?.address ?? ''),
        city: String(addr?.city ?? ''),
        country: String(addr?.country ?? ''),
        zipCode: String(addr?.zipCode ?? ''),
        countryCode: String(addr?.countryCode ?? ''),
        latitude: Number(coords[1] ?? 0),
        longitude: Number(coords[0] ?? 0),
      },
      status: String(doc.status ?? ''),
    };
  }

  private _diffAdminVendorProfileSnapshots(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): { changedFields: string[]; before: Record<string, unknown>; after: Record<string, unknown> } {
    const changedFields: string[] = [];
    const beforeOut: Record<string, unknown> = {};
    const afterOut: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const b = before[key];
      const a = after[key];
      const same =
        JSON.stringify(b ?? null) === JSON.stringify(a ?? null);
      if (!same) {
        changedFields.push(key);
        beforeOut[key] = b ?? null;
        afterOut[key] = a ?? null;
      }
    }
    return { changedFields, before: beforeOut, after: afterOut };
  }

  /** Détail fiche onboarding + historique pour l’admin vendeurs. */
  async getVendorStoreDetailForAdmin(storeId: string, admin: UserModel) {
    await this._assertAdminVendorPermission(admin);
    const doc = await this._storeModel
      .findById(storeId)
      .populate({
        path: 'owner',
        select: 'fullName email',
      })
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode location',
      })
      .lean()
      .exec();
    if (!doc) {
      throw new NotFoundException('store_not_found');
    }
    const row = doc as Record<string, unknown>;
    const addr = row.address as Record<string, unknown> | undefined;
    const profileSnapshot = this._adminVendorProfileSnapshot(row, addr);
    const { status: _status, ...profile } = profileSnapshot;
    const rawMessages =
      (row.vendorMessages as Record<string, unknown>[]) ?? [];
    const messages = [...rawMessages]
      .sort(
        (a, b) =>
          new Date(String(b.createdAt)).getTime() -
          new Date(String(a.createdAt)).getTime(),
      )
      .map((m) => ({
        message: String(m.message ?? ''),
        from: String(m.from ?? 'SYSTEM'),
        createdAt: m.createdAt,
      }));
    const owner = row.owner as Record<string, unknown> | undefined;
    const planByStore = await this._resolveSubscriptionPlanByStoreIds([
      storeId,
    ]);
    const audit = await this._dashboardAudit.listRecentForAdminVendorStore(
      admin,
      storeId,
      50,
    );
    return {
      store: this._mapStoreToAdminVendorRow(row, {
        subscriptionPlan: planByStore.get(storeId),
      }),
      profile,
      messages,
      owner: owner
        ? {
            id: String(owner._id ?? ''),
            fullName: String(owner.fullName ?? '').trim(),
            email: String(owner.email ?? '').trim(),
          }
        : null,
      auditEvents: audit.items,
    };
  }

  /** Édition admin des informations onboarding d’une boutique. */
  async updateVendorStoreForAdmin(
    storeId: string,
    admin: UserModel,
    args: AdminPatchVendorStoreDto,
  ) {
    await this._assertAdminVendorPermission(admin);
    await this._businessTypesService.assertActiveSlug(args.businessType);
    this._assertVendorShopAddressForOnboarding(args.address);
    const store = await this._storeModel
      .findById(storeId)
      .populate('address')
      .populate('owner')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    const ownerRef = store.owner as unknown;
    const ownerId =
      ownerRef &&
      typeof ownerRef === 'object' &&
      '_id' in (ownerRef as object)
        ? String((ownerRef as { _id: { toString(): string } })._id)
        : String(ownerRef ?? '');
    if (!ownerId) {
      throw new BadRequestException('store_owner_missing');
    }
    const fullOwner = await this._usersService.findById(ownerId);
    await this._supportedCountries.assertVendorApplicationCompatible(
      fullOwner,
      args,
    );
    const explicitCurrency = String(args.currency ?? '')
      .trim()
      .toUpperCase();
    const storeRegion = this._resolveStoreRegion(args);
    const storeCurrency =
      explicitCurrency.length === 3
        ? explicitCurrency
        : await this._resolveCurrencyForCountryCode(storeRegion);
    const dup = await this._storeModel
      .findOne({ name: args.name, _id: { $ne: store._id } })
      .exec();
    if (dup) {
      throw new ConflictException('store_already_exists');
    }
    const addrDoc = store.address as AddressModel & {
      _id: { toString(): string };
    };
    if (!addrDoc?._id) {
      throw new BadRequestException('store_address_missing');
    }
    const addrLean = addrDoc
      ? (addrDoc as unknown as Record<string, unknown>)
      : null;
    const before = this._adminVendorProfileSnapshot(
      store.toObject() as Record<string, unknown>,
      addrLean,
    );
    if (args.supportsShipping && (args.shippingZones?.length ?? 0) > 0) {
      for (const z of args.shippingZones ?? []) {
        if (z.minDistance > z.maxDistance) {
          throw new BadRequestException('invalid_shipping_zone_distances');
        }
      }
    }
    const addrId = addrDoc._id.toString();
    await this._addressesService.patchById(addrId, {
      ...args.address,
      latitude: args.address.latitude,
      longitude: args.address.longitude,
    });
    const shippingZones = args.supportsShipping
      ? args.shippingZones ?? store.shippingZones ?? []
      : [];
    const deliveryDriverSettings = this._normalizeVendorDeliveryDriverSettings(
      args,
    );
    const wantsPreOrders = this._normalizeMealPreOrdersFlag(
      args.acceptsMealPreOrders,
    );
    await this._assertMealPreOrdersAllowedForStore(
      (store._id as { toString(): string }).toString(),
      wantsPreOrders,
    );
    const setFields: Record<string, unknown> = {
      name: args.name,
      bio: args.bio,
      email: args.email,
      phoneNumber: args.phoneNumber,
      region: storeRegion,
      currency: storeCurrency,
      supportsShipping: args.supportsShipping,
      acceptsOrders: args.acceptsOrders !== false,
      shippingZones,
      acceptsMealPreOrders: wantsPreOrders,
      mealPreOrderCatalogScope: this._normalizeMealPreOrderCatalogScope(
        args.mealPreOrderCatalogScope,
      ),
      vendorManagesDeliveryDrivers:
        deliveryDriverSettings.vendorManagesDeliveryDrivers,
      deliveryAssignmentMode: deliveryDriverSettings.deliveryAssignmentMode,
    };
    const updateDoc: Record<string, unknown> = { $set: setFields };
    if (args.businessType) {
      setFields.businessType = args.businessType;
    } else {
      updateDoc.$unset = { businessType: 1 };
    }
    await this._storeModel.updateOne({ _id: store._id }, updateDoc);
    const adminNote = args.adminNote?.trim();
    if (adminNote) {
      await this._storeModel.updateOne(
        { _id: store._id },
        {
          $push: {
            vendorMessages: {
              message: adminNote,
              from: 'ADMIN',
              createdAt: new Date(),
            },
          },
        },
      );
    } else {
      await this._storeModel.updateOne(
        { _id: store._id },
        {
          $push: {
            vendorMessages: {
              message: 'Informations établissement mises à jour par l’équipe.',
              from: 'ADMIN',
              createdAt: new Date(),
            },
          },
        },
      );
    }
    const refreshed = await this._storeModel
      .findById(storeId)
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode location',
      })
      .lean()
      .exec();
    const afterRow = refreshed as Record<string, unknown>;
    const afterAddr = afterRow.address as Record<string, unknown> | undefined;
    const after = this._adminVendorProfileSnapshot(afterRow, afterAddr);
    const diff = this._diffAdminVendorProfileSnapshots(before, after);
    this._dashboardAudit.recordPlatformEvent(admin, {
      action: 'ADMIN_VENDOR_STORE_UPDATED',
      category: 'vendors',
      path: `/vendeurs/${storeId}`,
      storeId,
      resource: 'vendor_store',
      resourceId: storeId,
      metadata: {
        storeName: String(after.name ?? store.name),
        changedFields: diff.changedFields,
        before: diff.before,
        after: diff.after,
        ...(adminNote ? { adminNote } : {}),
      },
    });
    this._wsInboxNotify.notifyUserInboxRefresh(ownerId);
    await this._invalidatePublicCatalogCachesForStore(storeId);
    return this.getVendorStoreDetailForAdmin(storeId, admin);
  }

  /** Demande de corrections au vendeur (statut REVISION + message). */
  async requestVendorStoreRevisionForAdmin(
    storeId: string,
    admin: UserModel,
    message: string,
  ) {
    await this._assertAdminVendorPermission(admin);
    const doc = await this._storeModel.findById(storeId).exec();
    if (!doc) {
      throw new NotFoundException('store_not_found');
    }
    const trimmed = message.trim();
    const previousStatus = doc.status;
    doc.status = StoreStatusEnum.REVISION;
    doc.vendorMessages = [
      ...(doc.vendorMessages || []),
      {
        message: trimmed,
        from: 'ADMIN',
        createdAt: new Date(),
      },
    ];
    await doc.save();
    const ownerId = this.stringifyIdLike(doc.owner);
    if (ownerId) {
      this._wsInboxNotify.notifyUserInboxRefresh(ownerId);
    }
    this._dashboardAudit.recordPlatformEvent(admin, {
      action: 'ADMIN_VENDOR_STORE_REVISION_REQUESTED',
      category: 'vendors',
      path: `/vendeurs/${storeId}`,
      storeId,
      resource: 'vendor_store',
      resourceId: storeId,
      metadata: {
        storeName: doc.name,
        previousStatus,
        newStatus: StoreStatusEnum.REVISION,
        message: trimmed,
      },
    });
    return this.getVendorStoreDetailForAdmin(storeId, admin);
  }

  /** Supprime une boutique non active (PENDING / REVISION / INACTIVE) — admin uniquement. */
  async deleteVendorStoreForAdmin(storeId: string, admin: UserModel) {
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    const doc = await this._storeModel
      .findById(storeId)
      .select('_id status owner address profileImage')
      .exec();
    if (!doc) {
      throw new NotFoundException('store_not_found');
    }
    if (
      ![
        StoreStatusEnum.PENDING,
        StoreStatusEnum.REVISION,
        StoreStatusEnum.INACTIVE,
      ].includes(doc.status)
    ) {
      throw new ForbiddenException('store_delete_only_non_approved');
    }

    const ownerId =
      doc.owner != null &&
      typeof (doc.owner as { toString?: () => string }).toString === 'function'
        ? (doc.owner as { toString: () => string }).toString()
        : '';
    const addressId =
      doc.address != null &&
      typeof (doc.address as { toString?: () => string }).toString ===
        'function'
        ? (doc.address as { toString: () => string }).toString()
        : '';
    const imageUrl =
      typeof doc.profileImage === 'string' ? doc.profileImage : '';

    await this._storeModel.deleteOne({ _id: doc._id }).exec();
    if (ownerId) {
      await this._userModel
        .updateOne({ _id: ownerId }, { $pull: { stores: doc._id } })
        .exec();
    }
    if (addressId) {
      await this._addressModel.deleteOne({ _id: addressId }).exec();
    }
    if (imageUrl.startsWith('http')) {
      await this._mediasService.delete(imageUrl).catch(() => undefined);
    }
    return { ok: true, storeId: String(doc._id) };
  }

  private async _sendVendorStoreStatusUpdatedEmail(
    ownerId: string,
    store: StoreModel,
    status: StoreStatusEnum.ACTIVE | StoreStatusEnum.INACTIVE,
  ): Promise<void> {
    const owner = await this._userModel
      .findById(ownerId)
      .select('fullName email')
      .lean()
      .exec();
    const emailTo = String(owner?.email ?? '')
      .trim()
      .toLowerCase();
    if (!emailTo) return;
    const ownerName = String(owner?.fullName ?? '').trim();
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const statusLabel = status === StoreStatusEnum.ACTIVE ? 'Actif' : 'Inactif';
    const safeStore = this._escapeHtml(
      String(store.name ?? 'Votre restaurant'),
    );
    const safeOwner = this._escapeHtml(ownerName || 'restaurant');
    const safeStatus = this._escapeHtml(statusLabel);
    const statusHint =
      status === StoreStatusEnum.ACTIVE
        ? 'Votre boutique est maintenant active et peut recevoir des commandes.'
        : "Votre boutique est actuellement inactive. Si besoin, contactez l'équipe support pour plus d'informations.";
    const html = [
      this._emailTpl.heading('Statut de votre restaurant'),
      this._emailTpl.paragraph(`Bonjour <strong>${safeOwner}</strong>,`),
      this._emailTpl.paragraph(
        `Le statut de votre restaurant <strong>${safeStore}</strong> a été mis à jour par l'équipe <strong>${this._escapeHtml(appName)}</strong>.`,
      ),
      this._emailTpl.infoPanel(
        `${this._emailTpl.paragraph(`Nouveau statut : <strong>${safeStatus}</strong>`)}${this._emailTpl.muted(statusHint)}`,
      ),
    ].join('\n');
    const text = [
      `Bonjour ${ownerName || 'restaurant'},`,
      ``,
      `Le statut de votre restaurant "${String(
        store.name ?? 'Restaurant',
      )}" a ete mis a jour par l'equipe ${appName}.`,
      `Nouveau statut : ${statusLabel}.`,
      ``,
      status === StoreStatusEnum.ACTIVE
        ? 'Votre boutique est maintenant active et peut recevoir des commandes.'
        : "Votre boutique est actuellement inactive. Si besoin, contactez l'equipe support pour plus d'informations.",
    ].join('\n');
    await this._mailerService.sendSimple({
      to: emailTo,
      toName: ownerName || undefined,
      subject: `${appName} — Statut de votre restaurant mis a jour`,
      html,
      text,
    });
  }

  private _escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** URL page d’inscription avec rôle restaurant (voir `DASHBOARD_BASE_URL` ou `VENDOR_SIGNUP_URL`). */
  private _buildVendorSignupUrl(): string {
    const explicit =
      this._configService.get<string>('VENDOR_SIGNUP_URL')?.trim() ||
      this._configService.get<string>('DASHBOARD_VENDOR_SIGNUP_URL')?.trim();
    if (explicit) {
      return explicit.replace(/\/+$/, '');
    }
    const base =
      this._configService.get<string>('DASHBOARD_BASE_URL')?.trim() ||
      this._configService.get<string>('FRONTEND_URL')?.trim() ||
      this._configService.get<string>('CLIENT_APP_URL')?.trim();
    if (!base) {
      throw new BadRequestException('signup_link_not_configured');
    }
    const b = base.replace(/\/+$/, '');
    const url = new URL(`${b}/signup`);
    url.searchParams.set('role', 'restaurant');
    return url.toString();
  }

  /**
   * Envoie un courriel d’invitation avec le lien d’inscription restaurant (admin uniquement).
   */
  async sendVendorInvitationEmail(
    admin: UserModel,
    dto: VendorInvitationDto,
  ): Promise<{ ok: true }> {
    if (admin.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    const signupUrl = this._buildVendorSignupUrl();
    const appName =
      this._configService.get<string>('APP_NAME') ?? 'Wise Eat';
    const nom = dto.nom.trim();
    const prenom = dto.prenom.trim();
    const phone = dto.phoneNumber.trim();
    const emailTo = dto.email.trim().toLowerCase();
    const recipientName = `${prenom} ${nom}`.trim();

    const safe = {
      prenom: this._escapeHtml(prenom),
      nom: this._escapeHtml(nom),
      phone: this._escapeHtml(phone),
      email: this._escapeHtml(emailTo),
      app: this._escapeHtml(appName),
    };

    const subject = `${appName} — Inscription restaurant`;

    const html = [
      this._emailTpl.heading('Invitation restaurant'),
      this._emailTpl.paragraph(
        `Bonjour <strong>${safe.prenom} ${safe.nom}</strong>,`,
      ),
      this._emailTpl.paragraph(
        `Vous avez été invité·e à créer un compte <strong>restaurant</strong> sur <strong>${safe.app}</strong>.`,
      ),
      this._emailTpl.paragraph(
        'Cliquez sur le bouton ci-dessous pour commencer votre inscription :',
      ),
      this._emailTpl.button('Créer mon compte restaurant', signupUrl),
      this._emailTpl.muted(
        `Lien direct : <span style="word-break:break-all;">${this._escapeHtml(signupUrl)}</span>`,
      ),
      this._emailTpl.divider(),
      this._emailTpl.keyValues([
        { label: 'Téléphone', value: safe.phone },
        { label: 'Courriel', value: safe.email },
      ]),
    ].join('\n');

    const text = [
      `Bonjour ${prenom} ${nom},`,
      ``,
      `Vous avez été invité·e à créer un compte restaurant sur ${appName}.`,
      `Lien d'inscription : ${signupUrl}`,
      ``,
      `Coordonnées communiquées :`,
      `Téléphone : ${phone}`,
      `Courriel : ${emailTo}`,
    ].join('\n');

    await this._mailerService.sendSimple({
      to: emailTo,
      toName: recipientName,
      subject,
      html,
      text,
    });

    return { ok: true };
  }
}
