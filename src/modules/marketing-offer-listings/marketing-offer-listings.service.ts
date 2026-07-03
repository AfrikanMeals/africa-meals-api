import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MarketingOfferListingModel,
  MarketingOfferListingStatusEnum,
} from '@schemas/marketing-offer-listing.schema';
import {
  MarketingOfferModel,
  MarketingOfferModerationStatusEnum,
} from '@schemas/marketing-offer.schema';
import {
  ProductModel,
  ProductStatusEnum,
} from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import {
  UserRecommendationSignalKind,
  UserRecommendationSignalModel,
} from '@schemas/user-recommendation-signal.schema';
import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { Model, Types } from 'mongoose';
import { CartService } from '@modules/cart/cart.service';
import { AddItemToCartDto } from '@modules/cart/dto/cart.dto';
import {
  CreateMarketingOfferListingDto,
  PatchMarketingOfferListingDto,
} from './dto/marketing-offer-listings.dto';
import {
  computeStrategyPricing,
  computeStrategyPricingForQuantity,
  computeCartStrategyBenefit,
  isCartLevelStrategyType,
  isDirectCheckoutStrategyType,
} from './marketing-offer-strategy-pricing.util';

export type MarketingOfferListingRow = {
  id: string;
  storeId: string;
  marketingOfferId: string;
  marketingOfferType: string;
  strategyName: string;
  strategyRule: string;
  productId: string;
  productTitle: string;
  productImage?: string;
  productPrice: number;
  buyQuantity?: number;
  getQuantity?: number;
  rewardPercent?: number;
  spendThreshold?: number;
  rewardFixedAmount?: number;
  status: MarketingOfferListingStatusEnum;
  engagementScore: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ExclusiveStrategyDealRow = {
  listingId: string;
  strategyType: string;
  strategyName: string;
  strategyRule: string;
  badgeFr: string;
  badgeEn: string;
  productId: string;
  productTitle: string;
  productImage?: string;
  storeId: string;
  storeName: string;
  storeImage?: string;
  storeRating: number;
  currency: string;
  regionCode?: string;
  unitPrice: number;
  cartUnitPrice: number;
  checkoutQuantity: number;
  lineTotal: number;
  supportsShipping: boolean;
  cartLevelStrategy: boolean;
  spendThreshold?: number;
};

export type DirectCheckoutPreparedRow = ExclusiveStrategyDealRow & {
  storeSlug?: string;
};

@Injectable()
export class MarketingOfferListingsService {
  constructor(
    @InjectModel(MarketingOfferListingModel.name)
    private readonly listingModel: Model<MarketingOfferListingModel>,
    @InjectModel(MarketingOfferModel.name)
    private readonly offerModel: Model<MarketingOfferModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(UserRecommendationSignalModel.name)
    private readonly signalModel: Model<UserRecommendationSignalModel>,
    private readonly cartService: CartService,
  ) {}

  private toIso(d: unknown): string | undefined {
    if (!d) return undefined;
    const dt = d instanceof Date ? d : new Date(String(d));
    return Number.isNaN(dt.getTime()) ? undefined : dt.toISOString();
  }

  private resolveProductUnitPrice(product: {
    price?: number;
    discountPrice?: number;
  }): number {
    const discount = Number(product.discountPrice ?? 0);
    if (discount > 0) return discount;
    return Math.max(0, Number(product.price ?? 0));
  }

  private async assertStoreOwner(storeId: string, user: UserModel) {
    const store = await this.storeModel
      .findOne({ _id: storeId, owner: user._id })
      .lean()
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }
    return store;
  }

  async listForStore(
    storeId: string,
    user: UserModel,
  ): Promise<MarketingOfferListingRow[]> {
    await this.assertStoreOwner(storeId, user);
    const rows = await this.listingModel
      .find({ storeId: new Types.ObjectId(storeId) })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return this.hydrateListingRows(rows);
  }

  async createForStore(
    storeId: string,
    dto: CreateMarketingOfferListingDto,
    user: UserModel,
  ): Promise<MarketingOfferListingRow> {
    await this.assertStoreOwner(storeId, user);
    const offer = await this.offerModel.findById(dto.marketingOfferId).lean().exec();
    if (!offer) {
      throw new NotFoundException('marketing_offer_not_found');
    }
    if (offer.moderationStatus === MarketingOfferModerationStatusEnum.BLOCKED) {
      throw new BadRequestException('marketing_offer_blocked');
    }
    if (!isDirectCheckoutStrategyType(offer.type)) {
      throw new BadRequestException('marketing_offer_not_direct_checkout');
    }
    if (
      isCartLevelStrategyType(offer.type) &&
      !(Number(dto.spendThreshold) > 0)
    ) {
      throw new BadRequestException('spend_threshold_required');
    }

    const product = await this.productModel
      .findOne({
        _id: dto.productId,
        store: storeId,
        status: ProductStatusEnum.ACTIVE,
      })
      .lean()
      .exec();
    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    const doc = await this.listingModel.create({
      storeId: new Types.ObjectId(storeId),
      marketingOfferId: offer._id,
      marketingOfferType: offer.type,
      productId: product._id,
      buyQuantity: dto.buyQuantity,
      getQuantity: dto.getQuantity,
      rewardPercent: dto.rewardPercent,
      spendThreshold: dto.spendThreshold,
      rewardFixedAmount: dto.rewardFixedAmount,
      status: MarketingOfferListingStatusEnum.ACTIVE,
    });

    const [row] = await this.hydrateListingRows([doc.toObject()]);
    return row;
  }

  async patchForStore(
    storeId: string,
    listingId: string,
    dto: PatchMarketingOfferListingDto,
    user: UserModel,
  ): Promise<MarketingOfferListingRow> {
    await this.assertStoreOwner(storeId, user);
    const updated = await this.listingModel
      .findOneAndUpdate(
        {
          _id: listingId,
          storeId: new Types.ObjectId(storeId),
        },
        { $set: dto },
        { new: true },
      )
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException('listing_not_found');
    }
    const [row] = await this.hydrateListingRows([updated]);
    return row;
  }

  async deleteForStore(
    storeId: string,
    listingId: string,
    user: UserModel,
  ): Promise<void> {
    await this.assertStoreOwner(storeId, user);
    const res = await this.listingModel
      .deleteOne({
        _id: listingId,
        storeId: new Types.ObjectId(storeId),
      })
      .exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('listing_not_found');
    }
  }

  async listApprovedStrategiesForVendor() {
    return this.offerModel
      .find({ moderationStatus: MarketingOfferModerationStatusEnum.APPROVED })
      .sort({ number: 1 })
      .select('id number type name rule example phase priority')
      .lean()
      .exec()
      .then((rows) =>
        rows
          .filter((r) => isDirectCheckoutStrategyType(r.type))
          .map((r) => ({
            id: String(r._id),
            number: r.number,
            type: r.type,
            name: r.name,
            rule: r.rule,
            example: r.example,
            phase: r.phase,
            priority: r.priority,
          })),
      );
  }

  private async hydrateListingRows(
    rows: Array<Record<string, unknown>>,
  ): Promise<MarketingOfferListingRow[]> {
    if (!rows.length) return [];
    const offerIds = [...new Set(rows.map((r) => String(r.marketingOfferId)))];
    const productIds = [...new Set(rows.map((r) => String(r.productId)))];
    const [offers, products] = await Promise.all([
      this.offerModel
        .find({ _id: { $in: offerIds } })
        .select('name rule type')
        .lean()
        .exec(),
      this.productModel
        .find({ _id: { $in: productIds } })
        .select('title profileImage price discountPrice')
        .lean()
        .exec(),
    ]);
    const offerById = new Map(offers.map((o) => [String(o._id), o]));
    const productById = new Map(products.map((p) => [String(p._id), p]));

    return rows.map((r) => {
      const offer = offerById.get(String(r.marketingOfferId));
      const product = productById.get(String(r.productId));
      return {
        id: String(r._id),
        storeId: String(r.storeId),
        marketingOfferId: String(r.marketingOfferId),
        marketingOfferType: String(r.marketingOfferType ?? offer?.type ?? ''),
        strategyName: String(offer?.name ?? ''),
        strategyRule: String(offer?.rule ?? ''),
        productId: String(r.productId),
        productTitle: String(product?.title ?? ''),
        productImage: product?.profileImage ?? undefined,
        productPrice: this.resolveProductUnitPrice(product ?? {}),
        buyQuantity: r.buyQuantity as number | undefined,
        getQuantity: r.getQuantity as number | undefined,
        rewardPercent: r.rewardPercent as number | undefined,
        spendThreshold: r.spendThreshold as number | undefined,
        rewardFixedAmount: r.rewardFixedAmount as number | undefined,
        status: r.status as MarketingOfferListingStatusEnum,
        engagementScore: Number(r.engagementScore ?? 0),
        createdAt: this.toIso(r.createdAt),
        updatedAt: this.toIso(r.updatedAt),
      };
    });
  }

  private listingIsCurrentlyValid(listing: {
    validFrom?: Date;
    validUntil?: Date;
  }): boolean {
    const now = Date.now();
    if (listing.validFrom && listing.validFrom.getTime() > now) return false;
    if (listing.validUntil && listing.validUntil.getTime() < now) return false;
    return true;
  }

  private async loadActiveListingCandidates(regionCode?: string) {
    const now = new Date();
    const listings = await this.listingModel
      .find({
        status: MarketingOfferListingStatusEnum.ACTIVE,
        $and: [
          {
            $or: [{ validFrom: { $exists: false } }, { validFrom: { $lte: now } }],
          },
          {
            $or: [
              { validUntil: { $exists: false } },
              { validUntil: { $gte: now } },
            ],
          },
        ],
      })
      .lean()
      .exec();
    if (!listings.length) return [];

    const offerIds = [...new Set(listings.map((l) => String(l.marketingOfferId)))];
    const productIds = [...new Set(listings.map((l) => String(l.productId)))];
    const storeIds = [...new Set(listings.map((l) => String(l.storeId)))];

    const [offers, products, stores] = await Promise.all([
      this.offerModel
        .find({
          _id: { $in: offerIds },
          moderationStatus: MarketingOfferModerationStatusEnum.APPROVED,
        })
        .lean()
        .exec(),
      this.productModel
        .find({
          _id: { $in: productIds },
          status: ProductStatusEnum.ACTIVE,
        })
        .lean()
        .exec(),
      this.storeModel
        .find({
          _id: { $in: storeIds },
          status: StoreStatusEnum.ACTIVE,
          acceptsOrders: true,
        })
        .lean()
        .exec(),
    ]);

    const offerById = new Map(offers.map((o) => [String(o._id), o]));
    const productById = new Map(products.map((p) => [String(p._id), p]));
    const storeById = new Map(stores.map((s) => [String(s._id), s]));
    const region = String(regionCode ?? '').trim().toUpperCase();

    return listings
      .filter((l) => {
        if (!this.listingIsCurrentlyValid(l)) return false;
        const offer = offerById.get(String(l.marketingOfferId));
        const product = productById.get(String(l.productId));
        const store = storeById.get(String(l.storeId));
        if (!offer || !product || !store) return false;
        if (!isDirectCheckoutStrategyType(offer.type)) return false;
        if (
          isCartLevelStrategyType(offer.type) &&
          !(Number(l.spendThreshold) > 0)
        ) {
          return false;
        }
        if (region && String(store.region ?? '').toUpperCase() !== region) {
          return false;
        }
        return this.resolveProductUnitPrice(product) > 0;
      })
      .map((l) => ({
        listing: l,
        offer: offerById.get(String(l.marketingOfferId))!,
        product: productById.get(String(l.productId))!,
        store: storeById.get(String(l.storeId))!,
      }));
  }

  private scoreListing(
    candidate: Awaited<ReturnType<typeof this.loadActiveListingCandidates>>[number],
    signalProductIds: Set<string>,
    signalStoreIds: Set<string>,
    rng: () => number,
  ): number {
    let score = Number(candidate.listing.engagementScore ?? 0);
    if (signalProductIds.has(String(candidate.product._id))) score += 25;
    if (signalStoreIds.has(String(candidate.store._id))) score += 15;
    score += rng() * 10;
    return score;
  }

  private buildDealRow(
    candidate: Awaited<ReturnType<typeof this.loadActiveListingCandidates>>[number],
  ): ExclusiveStrategyDealRow {
    const unitPrice = this.resolveProductUnitPrice(candidate.product);
    const pricing = computeStrategyPricing({
      offerType: candidate.offer.type,
      unitPrice,
      buyQuantity: candidate.listing.buyQuantity,
      getQuantity: candidate.listing.getQuantity,
      rewardPercent: candidate.listing.rewardPercent,
      spendThreshold: candidate.listing.spendThreshold,
      rewardFixedAmount: candidate.listing.rewardFixedAmount,
    });

    return {
      listingId: String(candidate.listing._id),
      strategyType: candidate.offer.type,
      strategyName: candidate.offer.name,
      strategyRule: candidate.offer.rule,
      badgeFr: pricing.badgeFr,
      badgeEn: pricing.badgeEn,
      productId: String(candidate.product._id),
      productTitle: String(candidate.product.title ?? ''),
      productImage: candidate.product.profileImage ?? undefined,
      storeId: String(candidate.store._id),
      storeName: String(candidate.store.name ?? ''),
      storeImage: candidate.store.profileImage ?? undefined,
      storeRating: Math.max(
        0,
        Math.min(5, Number((candidate.store as { averageRating?: number }).averageRating ?? 4.5)),
      ),
      currency: String(candidate.store.currency ?? 'CAD'),
      regionCode: candidate.store.region ?? undefined,
      unitPrice,
      cartUnitPrice: pricing.cartUnitPrice,
      checkoutQuantity: pricing.checkoutQuantity,
      lineTotal: pricing.lineTotal,
      supportsShipping: !!candidate.store.supportsShipping,
      cartLevelStrategy: pricing.cartLevelStrategy,
      spendThreshold: candidate.listing.spendThreshold,
    };
  }

  async getExclusiveDealsFeed(args: {
    take?: number;
    regionCode?: string;
    user?: UserModel;
    seed?: string;
  }): Promise<{ deals: ExclusiveStrategyDealRow[] }> {
    const take = Math.min(5, Math.max(1, args.take ?? 5));
    const candidates = await this.loadActiveListingCandidates(args.regionCode);
    if (!candidates.length) return { deals: [] };

    let signalProductIds = new Set<string>();
    let signalStoreIds = new Set<string>();
    if (args.user?.id) {
      const signals = await this.signalModel
        .find({ user: new Types.ObjectId(args.user.id) })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean()
        .exec();
      for (const s of signals) {
        const id = String(s.refId);
        if (s.kind === UserRecommendationSignalKind.PRODUCT_VIEW) {
          signalProductIds.add(id);
        } else if (s.kind === UserRecommendationSignalKind.STORE_VIEW) {
          signalStoreIds.add(id);
        }
      }
    }

    let seedNum = 0;
    for (const ch of String(args.seed ?? args.user?.id ?? 'feed')) {
      seedNum = (seedNum * 31 + ch.charCodeAt(0)) >>> 0;
    }
    const rng = () => {
      seedNum = (seedNum * 1664525 + 1013904223) >>> 0;
      return seedNum / 0xffffffff;
    };

    const byType = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const key = c.offer.type;
      const list = byType.get(key) ?? [];
      list.push(c);
      byType.set(key, list);
    }

    const typeKeys = [...byType.keys()].sort(() => rng() - 0.5);
    const picked: typeof candidates = [];
    for (const type of typeKeys) {
      if (picked.length >= take) break;
      const pool = [...(byType.get(type) ?? [])].sort(
        (a, b) =>
          this.scoreListing(b, signalProductIds, signalStoreIds, rng) -
          this.scoreListing(a, signalProductIds, signalStoreIds, rng),
      );
      if (pool.length) picked.push(pool[0]);
    }

    if (picked.length < take) {
      const pickedIds = new Set(picked.map((p) => String(p.listing._id)));
      const rest = candidates
        .filter((c) => !pickedIds.has(String(c.listing._id)))
        .sort(
          (a, b) =>
            this.scoreListing(b, signalProductIds, signalStoreIds, rng) -
            this.scoreListing(a, signalProductIds, signalStoreIds, rng),
        );
      for (const c of rest) {
        if (picked.length >= take) break;
        picked.push(c);
      }
    }

    return { deals: picked.map((p) => this.buildDealRow(p)) };
  }

  async trackDealEngagement(
    listingId: string,
    event: 'click' | 'checkout_start',
  ): Promise<void> {
    const inc = event === 'checkout_start' ? 3 : 1;
    await this.listingModel
      .updateOne({ _id: listingId }, { $inc: { engagementScore: inc } })
      .exec();
  }

  async prepareDirectCheckout(
    listingId: string,
    user: UserModel,
    quantity?: number,
  ): Promise<DirectCheckoutPreparedRow> {
    const listing = await this.listingModel.findById(listingId).lean().exec();
    if (!listing || listing.status !== MarketingOfferListingStatusEnum.ACTIVE) {
      throw new NotFoundException('listing_not_found');
    }
    if (!this.listingIsCurrentlyValid(listing)) {
      throw new BadRequestException('listing_not_valid');
    }

    const [offer, product, storeDoc] = await Promise.all([
      this.offerModel.findById(listing.marketingOfferId).lean().exec(),
      this.productModel.findById(listing.productId).lean().exec(),
      // Document Mongoose (pas lean) : `cartService` utilise `store.id`.
      this.storeModel.findById(listing.storeId).exec(),
    ]);
    if (
      !offer ||
      offer.moderationStatus !== MarketingOfferModerationStatusEnum.APPROVED ||
      !product ||
      product.status !== ProductStatusEnum.ACTIVE ||
      !storeDoc ||
      storeDoc.status !== StoreStatusEnum.ACTIVE
    ) {
      throw new NotFoundException('listing_not_available');
    }
    const store = storeDoc;

    const pricingInput = {
      offerType: offer.type,
      unitPrice: this.resolveProductUnitPrice(product),
      buyQuantity: listing.buyQuantity,
      getQuantity: listing.getQuantity,
      rewardPercent: listing.rewardPercent,
      spendThreshold: listing.spendThreshold,
      rewardFixedAmount: listing.rewardFixedAmount,
    };
    const basePricing = computeStrategyPricing(pricingInput);
    if (!basePricing.directCheckoutEligible) {
      throw new BadRequestException('strategy_not_direct_checkout');
    }

    const requestedQty = Math.max(
      1,
      Math.min(999, Math.floor(Number(quantity) || 1)),
    );
    const pricing = computeStrategyPricingForQuantity({
      ...pricingInput,
      quantity: requestedQty,
    });
    if (!pricing.meetsConditions) {
      throw new BadRequestException('strategy_conditions_not_met');
    }

    await this.cartService.clearStoreCart(store as StoreModel, user);

    await this.cartService.addItemToCart(
      {
        type: CartItemTypeEnum.PRODUCT,
        itemId: String(product._id),
        quantity: pricing.requestedQuantity,
        price: pricing.cartUnitPrice,
      } as AddItemToCartDto,
      user,
      store as StoreModel,
    );

    if (pricing.cartLevelStrategy) {
      await this.cartService.setCartMarketingStrategy(
        user.id,
        String(store._id),
        listingId,
      );
    }

    await this.trackDealEngagement(listingId, 'checkout_start');

    const deal = this.buildDealRow({ listing, offer, product, store });
    return {
      ...deal,
      storeSlug: (store as { slug?: string }).slug ?? undefined,
    };
  }

  /** Bénéfice stratégie panier pour checkout Stripe (seuil, remise, livraison). */
  async previewCartStrategyForStore(
    user: UserModel,
    storeId: string,
    subtotal: number,
  ): Promise<{
    listingId: string;
    strategyType: string;
    meetsThreshold: boolean;
    discountAmount: number;
    freeDelivery: boolean;
    badgeFr: string;
    badgeEn: string;
  } | null> {
    const listingId = await this.cartService.getCartMarketingStrategyListingId(
      user.id,
      storeId,
    );
    if (!listingId) return null;

    const listing = await this.listingModel.findById(listingId).lean().exec();
    if (
      !listing ||
      listing.status !== MarketingOfferListingStatusEnum.ACTIVE ||
      !this.listingIsCurrentlyValid(listing) ||
      String(listing.storeId) !== String(storeId)
    ) {
      await this.cartService.clearCartMarketingStrategy(user.id, storeId);
      return null;
    }

    const offer = await this.offerModel.findById(listing.marketingOfferId).lean().exec();
    if (
      !offer ||
      offer.moderationStatus !== MarketingOfferModerationStatusEnum.APPROVED ||
      !isCartLevelStrategyType(offer.type)
    ) {
      await this.cartService.clearCartMarketingStrategy(user.id, storeId);
      return null;
    }

    const benefit = computeCartStrategyBenefit({
      offerType: offer.type,
      subtotal,
      spendThreshold: listing.spendThreshold,
      rewardFixedAmount: listing.rewardFixedAmount,
      rewardPercent: listing.rewardPercent,
    });

    return {
      listingId,
      strategyType: offer.type,
      meetsThreshold: benefit.meetsThreshold,
      discountAmount: benefit.discountAmount,
      freeDelivery: benefit.freeDelivery,
      badgeFr: benefit.badgeFr,
      badgeEn: benefit.badgeEn,
    };
  }

  async clearCartStrategyAfterCheckout(
    userId: string,
    storeId: string,
  ): Promise<void> {
    await this.cartService.clearCartMarketingStrategy(userId, storeId);
  }
}
