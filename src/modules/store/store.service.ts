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
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { RatingsService } from '@modules/ratings/ratings.service';
import { MailerService } from '@modules/mailer/mailer.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
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
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { CreateStoreDto, DailyMenuSlotDto, PatchVendorShippingZonesDto } from './dto/store.dto';
import { VendorInvitationDto } from './dto/vendor-invitation.dto';
import { DrinksService, maxDrinkOrderQuantity } from '@modules/drinks/drinks.service';
import { isStripeConnectOnboardingCompleteUser } from '@modules/billing/stripe/stripe-connect-visibility';
import { WsInboxNotifyService } from '@modules/ws-notify/ws-inbox-notify.service';

@Injectable()
export class StoreService {
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

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(ProductRatingModel.name)
  private readonly _productRatingModel: Model<ProductRatingModel>;

  @Inject(AddressesService)
  private readonly _addressesService: AddressesService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

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

  @Inject(MailerService)
  private readonly _mailerService: MailerService;

  @Inject(WsInboxNotifyService)
  private readonly _wsInboxNotify: WsInboxNotifyService;

  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  getStoreModel() {
    return this._storeModel;
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
    const owner = await this._userModel
      .findById(store.owner)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    return isStripeConnectOnboardingCompleteUser(owner);
  }

  async assertStoreVisibleOnMobileApp(storeId: string): Promise<void> {
    const ok = await this.isStoreVisibleOnMobileApp(storeId);
    if (!ok) {
      throw new NotFoundException('store_not_found');
    }
  }

  async findOneById(
    id: string,
    options?: { requireMobileVisibility?: boolean },
  ) {
    if (options?.requireMobileVisibility) {
      await this.assertStoreVisibleOnMobileApp(id);
    }
    const store = await this._storeModel
      .findOne({ _id: id })
      .populate('address')
      .populate('owner')
      .populate('ratings')
      .populate('likedBy')
      .exec();
    if (store?.dailyMenuByWeekday?.length) {
      (store as unknown as { dailyMenuByWeekday: unknown }).dailyMenuByWeekday =
        this.normalizeDailyMenuForApi(
          store.dailyMenuByWeekday as Record<string, unknown>[],
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
    const averageRating =
      Math.round((sum / count) * 10) / 10;
    return { averageRating, reviewCount: count };
  }

  /**
   * Fiche minimale pour l’écran « menu boutique » app (sans populate) — beaucoup plus rapide que {@link findOneById}.
   */
  async findPublicStoreMenuMeta(
    id: string,
  ): Promise<Record<string, unknown> | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    if (!(await this.isStoreVisibleOnMobileApp(id))) {
      return null;
    }
    const storeOid = new Types.ObjectId(id);
    const doc = await this._storeModel
      .findById(storeOid)
      .select('bio profileImage name status')
      .lean()
      .exec();
    if (doc == null) {
      return null;
    }
    const { averageRating, reviewCount } =
      await this.productReviewsAverageForStore(storeOid);
    const o = doc as unknown as Record<string, unknown>;
    const plain: Record<string, unknown> = {
      ...o,
      averageRating,
      reviewCount,
    };
    const oid = o['_id'];
    if (oid != null && typeof (oid as { toString?: () => string }).toString === 'function') {
      plain['id'] = (oid as { toString: () => string }).toString();
    }
    delete plain['_id'];
    delete plain['__v'];
    return plain;
  }

  async create(dto: CreateStoreDto, user: UserModel) {
    const { address, ...args } = dto;
    this._assertVendorShopAddressForOnboarding(address);
    const fullUser = await this._usersService.findById(
      (user._id as { toString(): string }).toString(),
    );
    await this._supportedCountries.assertVendorApplicationCompatible(
      fullUser,
      dto,
    );
    const exists = await this._storeModel.findOne({ name: args.name }).exec();

    if (exists) {
      throw new ConflictException('store_already_exists');
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

    const hasStore = await this._usersService.hasStore(user);

    if (hasStore) {
      throw new ConflictException('user_has_store');
    }

    const store = await this._storeModel.create({
      ...args,
      address: addr._id,
      owner: user._id,
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

    return this.findOneById(store._id.toString());
  }

  /** Résumé boutique pour l’écran vendeur (statut + messages + fiche éditable si PENDING/REVISION). */
  async findMyStoreSummary(user: UserModel) {
    const store = await this._storeModel
      .findOne({ owner: user._id })
      .populate({
        path: 'address',
        select: 'address city country zipCode countryCode location',
      })
      .select(
        'name bio email phoneNumber currency status vendorMessages acceptsOrders canCreateProducts createdAt updatedAt supportsShipping shippingZones address profileImage dailyMenuByWeekday',
      )
      .lean()
      .exec();
    if (!store) {
      return { store: null as null };
    }
    const doc = store as Record<string, unknown>;
    const raw = (doc.vendorMessages as Record<string, unknown>[]) ?? [];
    const messages = [...raw].sort(
      (a, b) =>
        new Date(String(b.createdAt)).getTime() -
        new Date(String(a.createdAt)).getTime(),
    );
    const st = doc.status as StoreStatusEnum;
    const canEditApplication = [
      StoreStatusEnum.PENDING,
      StoreStatusEnum.REVISION,
    ].includes(st);

    const addr = doc.address as AddressModel & {
      location?: { coordinates?: number[] };
    };
    const coords = addr?.location?.coordinates ?? [0, 0];
    const zones = (doc.shippingZones as Record<string, unknown>[]) ?? [];
    /** Fiche complète pour l’UI (lecture / édition selon canEditApplication). */
    const profile = {
      name: String(doc.name ?? ''),
      bio: String(doc.bio ?? ''),
      email: String(doc.email ?? ''),
      phoneNumber: String(doc.phoneNumber ?? ''),
      currency: String(doc.currency ?? 'CAD'),
      supportsShipping: !!doc.supportsShipping,
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

    const profileImage =
      typeof doc.profileImage === 'string' && doc.profileImage
        ? doc.profileImage
        : undefined;

    const rawMenu =
      (doc.dailyMenuByWeekday as
        | Array<Record<string, unknown>>
        | undefined) ?? [];
    const dailyMenuByWeekday = this.normalizeDailyMenuForApi(rawMenu);

    return {
      store: {
        id: (doc._id as { toString(): string }).toString(),
        name: doc.name as string,
        status: doc.status as string,
        acceptsOrders: !!doc.acceptsOrders,
        canCreateProducts: !!doc.canCreateProducts,
        supportsShipping: !!doc.supportsShipping,
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
      },
    };
  }

  async updateVendorDailyMenu(
    storeId: string,
    user: UserModel,
    slots: DailyMenuSlotDto[],
  ) {
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    const merged = new Map<
      number,
      { productId: string; stockUnlimited: boolean; stockRemaining: number }[]
    >();
    for (let d = 0; d <= 6; d++) {
      merged.set(d, []);
    }
    for (const s of slots) {
      const d = Math.min(6, Math.max(0, Math.floor(Number(s.dayOfWeek))));
      const entries = this.dailyMenuEntriesFromSlotDto(s);
      const byPid = new Map<
        string,
        { productId: string; stockUnlimited: boolean; stockRemaining: number }
      >();
      for (const e of entries) {
        byPid.set(e.productId, e);
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
        items: itemList.map((it) => ({
          productId: new Types.ObjectId(it.productId),
          stockUnlimited: it.stockUnlimited,
          stockRemaining: it.stockUnlimited ? 0 : Math.max(0, it.stockRemaining),
        })),
      }),
    );

    await this._storeModel
      .updateOne({ _id: storeId }, { $set: { dailyMenuByWeekday } })
      .exec();

    return this.findMyStoreSummary(user);
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
  ): Array<{
    dayOfWeek: number;
    items: Array<{
      productId: string;
      stockUnlimited: boolean;
      stockRemaining: number;
      soldOut: boolean;
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
          items.push({
            productId: pid,
            stockUnlimited,
            stockRemaining,
            soldOut: !stockUnlimited && stockRemaining <= 0,
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
      return { dayOfWeek, items };
    });
  }

  private dailyMenuEntriesFromSlotDto(s: DailyMenuSlotDto): {
    productId: string;
    stockUnlimited: boolean;
    stockRemaining: number;
  }[] {
    if (s.items?.length) {
      return s.items.map((i) => ({
        productId: String(i.productId).trim(),
        stockUnlimited: !!i.stockUnlimited,
        stockRemaining: i.stockUnlimited
          ? 0
          : Math.max(0, Math.floor(Number(i.stockRemaining ?? 0))),
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
    const rows = this.normalizeDailyMenuForApi(
      (doc?.dailyMenuByWeekday as Record<string, unknown>[]) ?? [],
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
    if (!(await this.dailyMenuNeedsLimitedDecrement(storeId, dayOfWeek, productId))) {
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
    const rows = this.normalizeDailyMenuForApi(
      (doc?.dailyMenuByWeekday as Record<string, unknown>[]) ?? [],
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
    cart: { items: Array<{ type?: string; entityId?: string; quantity?: number }> },
  ): Promise<void> {
    const raw = (store as { dailyMenuByWeekday?: unknown }).dailyMenuByWeekday;
    const rows = this.normalizeDailyMenuForApi(
      Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [],
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
   * Centre de notifications : tous les `vendorMessages` des boutiques dont l’utilisateur est propriétaire,
   * plus l’historique fidélité `rewardHistory` du document user (seule entrée type « messages » côté users).
   */
  async findMyNotificationFeed(user: UserModel) {
    const uid = user._id;
    const stores = await this._storeModel
      .find({ owner: uid })
      .select('name vendorMessages')
      .lean()
      .exec();

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
      const raw = (
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
        id: `user:reward:${String(r.createdAt ?? '')}:${String(r.reason ?? '').slice(0, 24)}`,
        source: 'user',
        message: `${sign}${pts} point${abs !== 1 ? 's' : ''} fidélité — ${String(r.reason ?? '')}`,
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

  /** Mise à jour fiche vendeur (dossier en PENDING ou REVISION). */
  async updateVendorApplication(user: UserModel, args: CreateStoreDto) {
    const fullUser = await this._usersService.findById(
      (user._id as { toString(): string }).toString(),
    );
    await this._supportedCountries.assertVendorApplicationCompatible(
      fullUser,
      args,
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
      ![StoreStatusEnum.PENDING, StoreStatusEnum.REVISION].includes(store.status)
    ) {
      throw new ForbiddenException('store_not_editable');
    }
    const dup = await this._storeModel
      .findOne({ name: args.name, _id: { $ne: store._id } })
      .exec();
    if (dup) {
      throw new ConflictException('store_already_exists');
    }
    const addrDoc = store.address as AddressModel & { _id: { toString(): string } };
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

    await this._storeModel.updateOne(
      { _id: store._id },
      {
        name: args.name,
        bio: args.bio,
        email: args.email,
        phoneNumber: args.phoneNumber,
        supportsShipping: args.supportsShipping,
        shippingZones,
        ...(wasRevision && { status: StoreStatusEnum.PENDING }),
      },
    );

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

    return this.findMyStoreSummary(user);
  }

  /**
   * Enregistre `supportsShipping` et `shippingZones` sans repasser par la fiche complète
   * (nécessaire pour les boutiques ACTIVE, car `updateVendorApplication` est réservé au dossier).
   */
  async updateVendorShippingZones(
    user: UserModel,
    args: PatchVendorShippingZonesDto,
  ) {
    const store = await this._storeModel.findOne({ owner: user._id }).exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (store.status === StoreStatusEnum.INACTIVE) {
      throw new ForbiddenException('store_not_editable');
    }
    const shippingZones = args.supportsShipping
      ? args.shippingZones ?? []
      : [];
    if (args.supportsShipping && shippingZones.length > 0) {
      for (const z of shippingZones) {
        if (z.minDistance > z.maxDistance) {
          throw new BadRequestException('invalid_shipping_zone_distances');
        }
      }
    }
    await this._storeModel.updateOne(
      { _id: store._id },
      {
        supportsShipping: args.supportsShipping,
        shippingZones,
      },
    );
    await this._storeModel.updateOne(
      { _id: store._id },
      {
        $push: {
          vendorMessages: {
            message: 'Préférence de livraison enregistrée.',
            from: 'SYSTEM',
            createdAt: new Date(),
          },
        },
      },
    );
    this._wsInboxNotify.notifyUserInboxRefresh(
      (user._id as { toString(): string }).toString(),
    );
    return this.findMyStoreSummary(user);
  }

  async updateProfileImage(
    id: string,
    file: Express.Multer.File,
    user: UserModel,
  ) {
    let url: string;
    try {
      const store = await this._storeModel
        .findOne({ _id: id, owner: user._id })
        .exec();

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
      console.log('🚀 ~ StoreService ~ updateProfileImage ~ e:', e);
      if (url) {
        await this._mediasService.delete(url);
      }
      throw e;
    }
  }

  async listStoreProducts(storeId: string, user: UserModel) {
    if (user.type === UserTypeEnum.ADMIN) {
      const exists = await this._storeModel
        .findById(storeId)
        .select('_id')
        .exec();
      if (!exists) {
        throw new NotFoundException('store_not_found');
      }
      return this._productsService.findByStoreId(storeId);
    }
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .select('_id')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    return this._productsService.findByStoreId(storeId);
  }

  async updateStoreProduct(
    storeId: string,
    productId: string,
    args: PatchProductDto,
    user: UserModel,
    image?: Express.Multer.File,
    gallery?: Express.Multer.File[],
  ) {
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .exec();
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
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .exec();
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
    const store = await this._storeModel
      .findOne({ _id: id, owner: user._id })
      .populate('address')
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
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
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .exec();

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

    if (store.owner._id.toString() === user.id.toString()) {
      throw new ForbiddenException('cannot_add_item_to_your_store_cart');
    }

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
        const ok = await this._drinksService.tryConsumeStock(
          storeId,
          did,
          qty,
        );
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
      .populate({ path: 'owner', select: 'fullName email' })
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode location',
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return (rows as Record<string, unknown>[]).map((s) =>
      this._mapStoreToAdminVendorRow(s),
    );
  }

  private _mapStoreToAdminVendorRow(s: Record<string, unknown>) {
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
      if (typeof raw === 'string' && raw.length) return new Date(raw).toISOString();
      return undefined;
    };

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
      createdAt: toIso(createdRaw),
      updatedAt: toIso(updatedRaw),
    };
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
    doc.status = status;
    if (status === StoreStatusEnum.INACTIVE) {
      doc.acceptsOrders = false;
      doc.canCreateProducts = false;
    } else {
      doc.acceptsOrders = true;
      doc.canCreateProducts = true;
    }

    if (previousStatus !== status) {
      const statusLabel = status === StoreStatusEnum.ACTIVE ? 'actif' : 'inactif';
      doc.vendorMessages = [
        ...(doc.vendorMessages || []),
        {
          message: `Le statut de votre restaurant a changé : ${statusLabel}.`,
          from: 'ADMIN',
          createdAt: new Date(),
        },
      ];
    }
    await doc.save();

    const ownerIdForWs = (() => {
      const o = doc.owner as unknown;
      if (o && typeof o === 'object' && '_id' in o) {
        return String((o as { _id: { toString(): string } })._id);
      }
      if (o != null && typeof (o as { toString?: () => string }).toString === 'function') {
        return String(o);
      }
      return '';
    })();
    if (ownerIdForWs) {
      this._wsInboxNotify.notifyUserInboxRefresh(ownerIdForWs);
    }

    const lean = await this._storeModel
      .findById(storeId)
      .populate({ path: 'owner', select: 'fullName email' })
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode',
      })
      .lean()
      .exec();
    return this._mapStoreToAdminVendorRow(lean as Record<string, unknown>);
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
      this._configService.get<string>('APP_NAME') ?? 'AfrikanEats';
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
    const hrefAttr = signupUrl.replace(/&/g, '&amp;');

    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;color:#374151;">
  <p>Bonjour ${safe.prenom} ${safe.nom},</p>
  <p>Vous avez été invité·e à créer un compte <strong>restaurant</strong> sur <strong>${safe.app}</strong>.</p>
  <p>Cliquez sur le lien ci-dessous pour commencer votre inscription :</p>
  <p><a href="${hrefAttr}" style="display:inline-block;margin:12px 0;padding:12px 20px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Créer mon compte restaurant</a></p>
  <p style="word-break:break-all;font-size:14px;color:#6b7280;">${this._escapeHtml(signupUrl)}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
  <p style="font-size:14px;color:#6b7280;">Coordonnées communiquées :<br/>
  Téléphone : ${safe.phone}<br/>
  Courriel : ${safe.email}</p>
  <p style="font-size:14px;color:#9ca3af;">— L’équipe ${safe.app}</p>
</body></html>`.trim();

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
