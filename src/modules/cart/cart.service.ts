import { CouponsService } from '@modules/coupons/coupons.service';
import { GiftCodesService } from '@modules/gift-codes/gift-codes.service';
import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { resolveEffectiveTimezone } from '@modules/supported-countries/region-timezone.util';
import {
  DrinksService,
  maxDrinkOrderQuantity,
} from '@modules/drinks/drinks.service';
import { OffersService } from '@modules/offers/offers.service';
import { ProductsService } from '@modules/products/products.service';
import { SubscriptionPlanOrderCommissionService } from '@modules/subscriptions/subscription-plan-order-commission.service';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  stableCacheHash,
} from '@common/redis-app-cache';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import { CartMarketingStrategyModel } from '@schemas/cart-marketing-strategy.schema';
import { MarketingOfferListingModel } from '@schemas/marketing-offer-listing.schema';
import { StoreCouponDiscountTypeEnum } from '@schemas/store_coupon.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  customizationKeyFromSelections,
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
  repriceCustomizationFromProductCatalog,
  sumSelectedCustomizationVendorExtras,
} from './cart-customization.util';
import {
  AddItemToCartDto,
  CartItemApiResponse,
  RemoveItemFromCartDto,
  ValidateCheckoutDto,
  PreviewCartGiftCodeDto,
} from './dto/cart.dto';
import {
  dailyMenuStockRemainingForStoreProduct,
  resolveDailyMenuProductCap,
} from '@utils/daily-menu-stock.util';
import { mapInChunks } from '@utils/map-in-chunks';
import { allocateBundleCartLinePrices } from '@modules/product-bundles/product-bundle-cart-pricing.util';

const roundMoneyCart = (n: number) => Math.round(n * 100) / 100;

/** Boutique + adresse géolocalisée (distance client ↔ restaurant sur le mobile). */
const cartStorePopulate = {
  path: 'store',
  populate: {
    path: 'address',
    select: 'address city country zipCode countryCode location label',
  },
} as const;

function storeIdFromPopulatedCartItem(item: { store?: unknown }): string {
  const s = item.store;
  if (s == null) return '';
  if (typeof s === 'string' || typeof s === 'number') {
    const id = String(s).trim();
    return id && id !== 'undefined' ? id : '';
  }
  if (typeof s === 'object') {
    const o = s as { _id?: unknown; id?: unknown };
    if (o._id != null) {
      return String(o._id);
    }
    if (o.id != null) {
      return String(o.id);
    }
  }
  const fallback = String(s).trim();
  return fallback && fallback !== 'undefined' ? fallback : '';
}

function badRequestExceptionKey(e: unknown): string {
  if (e instanceof BadRequestException) {
    const r = e.getResponse();
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object' && 'message' in r) {
      const m = (r as { message: unknown }).message;
      if (Array.isArray(m) && m.length) return String(m[0]);
      if (typeof m === 'string') return m;
    }
  }
  return 'unknown_error';
}

/** Forme proche d’un produit pour les clients (ex. app mobile `Entity`). */
function drinkEntityForCartApi(drink: {
  id: string;
  name: string;
  description: string;
  priceCad: number;
  currency?: string;
  imageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  quantite: number;
  seuil: number;
}) {
  const now = new Date().toISOString();
  return {
    _id: drink.id,
    title: drink.name,
    description: drink.description ?? '',
    price: drink.priceCad,
    currency: String(drink.currency ?? 'CAD')
      .trim()
      .toUpperCase(),
    profileImage: drink.imageUrl,
    createdAt: drink.createdAt ?? now,
    updatedAt: drink.updatedAt ?? now,
    quantite: drink.quantite,
    seuil: drink.seuil,
  };
}

@Injectable()
export class CartService {
  @InjectModel(CartItemModel.name)
  private readonly _cartItemModel: Model<CartItemModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(CartMarketingStrategyModel.name)
  private readonly _cartMarketingStrategyModel: Model<CartMarketingStrategyModel>;

  @InjectModel(MarketingOfferListingModel.name)
  private readonly _marketingOfferListingModel: Model<MarketingOfferListingModel>;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(SubscriptionPlanOrderCommissionService)
  private readonly _planOrderCommission: SubscriptionPlanOrderCommissionService;

  @Inject(OffersService)
  private readonly _offersService: OffersService;

  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  @Inject(CouponsService)
  private readonly _couponsService: CouponsService;

  @Inject(GiftCodesService)
  private readonly _giftCodesService: GiftCodesService;

  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  private async resolveStoreEffectiveTimezone(store: {
    timezone?: string | null;
    region?: string | null;
  }): Promise<string> {
    const regionCode = String(store.region ?? '')
      .trim()
      .toUpperCase();
    const regionTz = regionCode
      ? await this._supportedCountries.getTimezoneForCountry(regionCode)
      : undefined;
    return resolveEffectiveTimezone({
      storeTimezone: store.timezone,
      regionTimezone: regionTz,
      regionCode,
    });
  }

  /** Empreinte stable du panier pour clé cache pricing checkout. */
  async getCartPricingFingerprint(user: UserModel): Promise<string> {
    const rows = await this._cartItemModel
      .find({ user: new Types.ObjectId(user.id) })
      .select(
        'store entityId type quantity price customizationKey updatedAt',
      )
      .lean()
      .exec();
    const items = (rows ?? [])
      .map((r) => ({
        store: String((r as { store?: unknown }).store ?? ''),
        entityId: String((r as { entityId?: unknown }).entityId ?? ''),
        type: String((r as { type?: unknown }).type ?? ''),
        qty: Math.max(0, Math.floor(Number((r as { quantity?: number }).quantity ?? 0))),
        price: Number((r as { price?: number }).price ?? 0),
        ck: String((r as { customizationKey?: string }).customizationKey ?? ''),
        u: (r as { updatedAt?: Date }).updatedAt?.getTime?.() ?? 0,
      }))
      .sort(
        (a, b) =>
          a.store.localeCompare(b.store) ||
          a.entityId.localeCompare(b.entityId) ||
          a.type.localeCompare(b.type) ||
          a.ck.localeCompare(b.ck),
      );
    return stableCacheHash(items);
  }

  private async bustCartPricingCache(user: UserModel): Promise<void> {
    try {
      await this._cacheLayer.bustCartPricingForUser(user.id);
    } catch {
      /* cache optionnel */
    }
  }

  async findOneByStoreId(
    storeId: string,
    user: UserModel,
  ): Promise<CartItemApiResponse> {
    const items = await this._cartItemModel
      .find({
        store: new Types.ObjectId(storeId),
        user: new Types.ObjectId(user.id),
      })
      .populate(cartStorePopulate)
      .exec();

    if (!items?.length) {
      throw new NotFoundException('cart_not_found');
    }

    const mappedItems: Partial<CartItemModel>[] = (
      await mapInChunks(items, 4, (item) => this.findOneByItemId(item.id, user))
    ).map(({ store, ...item }) => ({ ...item }));

    const cart = {
      store: items[0].store,
      items: mappedItems,
      totalPrice: (mappedItems || []).reduce(
        (acc, item) => acc + item.price * item.quantity,
        0,
      ),
    };

    return cart;
  }

  async findOneByItemId(
    id: string,
    user: UserModel,
  ): Promise<Partial<CartItemModel>> {
    const item = await this._cartItemModel
      .findOne({ _id: new Types.ObjectId(id) })
      .populate(cartStorePopulate)
      .exec();
    if (!item) {
      throw new NotFoundException('cart_item_not_found');
    }

    if (item.type === CartItemTypeEnum.OFFER) {
      const offer = await this._offersService.findOne(item.entityId, user);
      if (!offer) {
        throw new NotFoundException('offer_not_found');
      }
      return {
        ...item.toJSON(),
        entity: offer,
      };
    } else if (item.type === CartItemTypeEnum.PRODUCT) {
      const product = await this._productsService.findOneById(item.entityId);
      if (!product) {
        throw new NotFoundException('product_not_found');
      }
      const st = item.store as {
        dailyMenuByWeekday?: unknown;
        timezone?: string;
        region?: string;
      };
      const effectiveTz = await this.resolveStoreEffectiveTimezone(st);
      const dailyMenuStockRemaining = dailyMenuStockRemainingForStoreProduct(
        { ...st, timezone: effectiveTz },
        item.entityId,
        effectiveTz,
      );
      return {
        ...item.toJSON(),
        entity: product,
        dailyMenuStockRemaining,
      } as unknown as Partial<CartItemModel>;
    } else if (item.type === CartItemTypeEnum.DRINK) {
      const storeId = storeIdFromPopulatedCartItem(item);
      const drink = await this._drinksService.findOneInStoreByIdRaw(
        storeId,
        item.entityId,
      );
      if (!drink) {
        throw new NotFoundException('drink_not_found');
      }
      const maxOrder = maxDrinkOrderQuantity(drink.quantite);
      return {
        ...item.toJSON(),
        entity: drinkEntityForCartApi({
          ...drink,
          currency: String(
            (item.store as { currency?: unknown })?.currency ?? 'CAD',
          ),
        }),
        drinkMaxOrderQuantity: maxOrder,
      } as unknown as Partial<CartItemModel>;
    } else if (item.type === CartItemTypeEnum.PRODUCT_EXTRA) {
      const product = await this._productsService.findOneById(
        String(item.productId ?? ''),
      );
      if (!product) {
        throw new NotFoundException('product_not_found');
      }
      const extras = Array.isArray(product.extras) ? product.extras : [];
      const extra = extras.find((e) => e.id === item.entityId);
      if (!extra) {
        throw new NotFoundException('extra_not_found');
      }
      return {
        ...item.toJSON(),
        entity: extra,
      };
    } else {
      throw new NotFoundException('unsupported_cart_item_type');
    }
  }

  async filter(user: UserModel): Promise<any> {
    const items = await this._cartItemModel
      .find({ user: new Types.ObjectId(user.id) })
      .populate([
        {
          path: 'user',
        },
        cartStorePopulate,
      ])
      .exec();

    const formatedItems = (items ?? []).reduce(
      (acc, item) => {
        const storeKey = storeIdFromPopulatedCartItem(item);
        if (!storeKey) {
          return acc;
        }
        if (!acc[storeKey]) {
          acc[storeKey] = {
            store: item.store,
            items: [],
          };
        }
        acc[storeKey].items.push(item);
        return acc;
      },
      {} as {
        [key: string]: {
          store: StoreModel;
          items: CartItemModel[];
        };
      },
    );

    const storeGroups = Object.values(formatedItems);
    // Ne pas masquer les lignes déjà en panier : le client doit les voir.
    // Le blocage Stripe / menu du jour reste sur validate-checkout et le paiement.
    const data = await mapInChunks(storeGroups, 2, async (group) => {
      const lineItems = await mapInChunks(group.items ?? [], 4, (line) =>
        this.findOneByItemId(line._id.toString(), user),
      );
      const items = lineItems.map(({ store, ...rest }) => rest);

      return {
        store: group.store,
        items,
        totalPrice: items.reduce(
          (acc, line) => acc + line.price * line.quantity,
          0,
        ),
      };
    });

    return { data };

    // return {
    //   items: await Promise.all(
    //     (items ?? []).map((item) =>
    //       this.findOneById(item._id.toString(), user),
    //     ),
    //   ),
    // };
  }

  private resolveProductCustomization(args: AddItemToCartDto) {
    if (args.type !== CartItemTypeEnum.PRODUCT) {
      return {
        selectedComplements: [] as ReturnType<typeof normalizeSelectedComplements>,
        selectedSupplements: [] as ReturnType<typeof normalizeSelectedSupplements>,
        selectedVariantLabel: undefined as string | undefined,
        customizationKey: '',
      };
    }
    const selectedComplements = normalizeSelectedComplements(
      args.selectedComplements,
    );
    const selectedSupplements = normalizeSelectedSupplements(
      args.selectedSupplements,
    );
    const selectedVariantLabel = String(args.selectedVariantLabel ?? '').trim();
    return {
      selectedComplements,
      selectedSupplements,
      selectedVariantLabel: selectedVariantLabel || undefined,
      customizationKey: customizationKeyFromSelections(
        selectedComplements,
        selectedSupplements,
        selectedVariantLabel,
      ),
    };
  }

  async itemExistsInCart(
    store: StoreModel,
    args: AddItemToCartDto,
    user: UserModel,
    customizationKey = '',
  ): Promise<CartItemModel> {
    // Exclure les lignes combo : un ajout classique ne doit pas fusionner dedans.
    return await this._cartItemModel
      .findOne({
        entityId: args.itemId,
        type: args.type,
        user: new Types.ObjectId(user.id),
        store: new Types.ObjectId(store.id),
        customizationKey: customizationKey ?? '',
        $or: [
          { bundleGroupId: { $exists: false } },
          { bundleGroupId: null },
          { bundleGroupId: '' },
        ],
      })
      .exec();
  }

  /** Quantité totale déjà dans le panier pour un produit (lignes `product`). */
  async sumQuantityForProductInCart(
    storeId: string,
    userId: string,
    productId: string,
  ): Promise<number> {
    const rows = await this._cartItemModel
      .find({
        store: new Types.ObjectId(storeId),
        user: new Types.ObjectId(userId),
        type: CartItemTypeEnum.PRODUCT,
        entityId: productId,
      })
      .select('quantity')
      .lean()
      .exec();
    return (rows ?? []).reduce(
      (acc, r) =>
        acc + Math.max(0, Number((r as { quantity?: number }).quantity ?? 0)),
      0,
    );
  }

  async updateQuantity(item: CartItemModel, qty: number) {
    return await this._cartItemModel
      .updateOne({ _id: item.id }, { $set: { quantity: +(qty ?? 1) } })
      .exec();
  }

  async addItemToCart(
    args: AddItemToCartDto,
    user: UserModel,
    store: StoreModel,
  ): Promise<Partial<CartItemModel>> {
    const qtyReq = +(args.quantity ?? 1);
    let priceForLine = args.price;
    const customization = this.resolveProductCustomization(args);

    // Lignes bundle : jamais fusionnées (chaque groupe UUID = 1 combo).
    const bundleGroupId = String(args.bundleGroupId ?? '').trim() || undefined;
    const bundleId = String(args.bundleId ?? '').trim() || undefined;
    const bundleTitle = String(args.bundleTitle ?? '').trim() || undefined;

    let item = bundleGroupId
      ? null
      : await this.itemExistsInCart(
          store,
          args,
          user,
          customization.customizationKey,
        );

    const storeId = String(store.id ?? (store as { _id?: unknown })._id ?? '');
    let lineStrategy: 'on_payout' | 'add_to_price' = 'on_payout';

    if (args.type === CartItemTypeEnum.DRINK) {
      const drink = await this._drinksService.findOneInStoreCatalog(
        store.id,
        args.itemId,
      );
      if (!drink) {
        throw new NotFoundException('drink_not_found');
      }
      priceForLine = drink.priceCad;
      const newTotalQty = (item?.quantity ?? 0) + qtyReq;
      const maxOrder = maxDrinkOrderQuantity(drink.quantite);
      if (newTotalQty > maxOrder) {
        throw new BadRequestException('drink_quantity_limit_exceeded');
      }
      if (storeId) {
        lineStrategy =
          await this._planOrderCommission.resolveEffectiveStrategyForCatalogItem(
            storeId,
            'drink',
            args.itemId,
          );
        priceForLine =
          await this._planOrderCommission.resolveCustomerUnitPriceForStore(
            storeId,
            Number(priceForLine),
            lineStrategy,
          );
      }
    } else if (args.type === CartItemTypeEnum.PRODUCT) {
      const product = await this._productsService.findOneById(args.itemId);
      if (!product) {
        throw new NotFoundException('product_not_found');
      }
      const productObj = (
        typeof (product as { toObject?: () => unknown }).toObject === 'function'
          ? (product as { toObject: () => Record<string, unknown> }).toObject()
          : (product as unknown as Record<string, unknown>)
      ) as Record<string, unknown>;

      let vendorBase = Number(productObj.price ?? args.price ?? 0);
      const variantLabel = customization.selectedVariantLabel;
      const variants = Array.isArray(productObj.variants)
        ? productObj.variants
        : [];
      if (variantLabel && variants.length) {
        const match = variants.find((v) => {
          const row = (v ?? {}) as Record<string, unknown>;
          return (
            String(row.label ?? row.name ?? '').trim() === variantLabel
          );
        }) as Record<string, unknown> | undefined;
        if (match) {
          const vp = Number(match.price ?? 0);
          const vd = Number(match.discountPrice ?? match.discount_price ?? 0);
          vendorBase = vd > 0 && vd < vp ? vd : vp;
        }
      } else {
        const disc = Number(
          productObj.discountPrice ?? productObj.discount_price ?? 0,
        );
        if (disc > 0 && disc < vendorBase) vendorBase = disc;
      }

      const repriced = repriceCustomizationFromProductCatalog(
        {
          complements: productObj.complements,
          supplements: productObj.supplements,
        },
        customization.selectedComplements,
        customization.selectedSupplements,
      );
      customization.selectedComplements = repriced.complements;
      customization.selectedSupplements = repriced.supplements;

      const vendorLine =
        Math.max(0, vendorBase) +
        sumSelectedCustomizationVendorExtras(
          repriced.complements,
          repriced.supplements,
        );
      if (storeId) {
        lineStrategy =
          await this._planOrderCommission.resolveEffectiveStrategyForCatalogItem(
            storeId,
            'product',
            args.itemId,
          );
        priceForLine =
          await this._planOrderCommission.resolveCustomerLineUnitPriceForStore(
            storeId,
            vendorBase,
            {
              complements: repriced.complements,
              supplements: repriced.supplements,
            },
            lineStrategy,
          );
      } else {
        priceForLine = vendorLine;
      }
    } else if (storeId && Number(priceForLine ?? 0) > 0) {
      priceForLine =
        await this._planOrderCommission.resolveCustomerUnitPriceForStore(
          storeId,
          Number(priceForLine),
        );
    }

    if (item) {
      const nextQty = (item.quantity ?? 0) + qtyReq;
      await this.updateQuantity(item, nextQty);
      if (args.type === CartItemTypeEnum.DRINK) {
        await this._cartItemModel
          .updateOne(
            { _id: item.id },
            {
              $set: {
                price: priceForLine,
                commissionRetrieveStrategy: lineStrategy,
              },
            },
          )
          .exec();
      } else if (args.type === CartItemTypeEnum.PRODUCT) {
        await this._cartItemModel
          .updateOne(
            { _id: item.id },
            {
              $set: {
                price: priceForLine,
                commissionRetrieveStrategy: lineStrategy,
                selectedComplements: customization.selectedComplements,
                selectedSupplements: customization.selectedSupplements,
                selectedVariantLabel: customization.selectedVariantLabel,
              },
            },
          )
          .exec();
      }
      item.quantity = nextQty;
      item.price = priceForLine;
      item.commissionRetrieveStrategy = lineStrategy;
    } else {
      item = await this._cartItemModel.create({
        user: new Types.ObjectId(user.id),
        store: new Types.ObjectId(store.id),
        entityId: args.itemId,
        ...(args.type === CartItemTypeEnum.PRODUCT_EXTRA && {
          productId: args.productId,
        }),
        type: args.type,
        quantity: qtyReq,
        price: priceForLine,
        commissionRetrieveStrategy: lineStrategy,
        customizationKey: customization.customizationKey,
        selectedComplements: customization.selectedComplements,
        selectedSupplements: customization.selectedSupplements,
        selectedVariantLabel: customization.selectedVariantLabel,
        // Combo : rattacher la ligne au groupe pour checkout / stock bundle.
        ...(bundleId && Types.ObjectId.isValid(bundleId)
          ? { bundleId: new Types.ObjectId(bundleId) }
          : {}),
        ...(bundleGroupId ? { bundleGroupId } : {}),
        ...(bundleTitle ? { bundleTitle } : {}),
      });
    }

    void this.bustCartPricingCache(user);
    return {
      _id: item.id,
      id: item.id,
      entityId: args.itemId,
      type: args.type,
      quantity: item.quantity ?? qtyReq,
      price: priceForLine,
      ...(bundleGroupId ? { bundleGroupId } : {}),
      ...(bundleId ? { bundleId } : {}),
      ...(bundleTitle ? { bundleTitle } : {}),
    };
  }

  /**
   * Applique le prix combo (remise bundle) sur les lignes d’un `bundleGroupId`.
   * Bases catalogue remisées ; extras perso conservés sur leur ligne.
   */
  async applyBundleGroupComboPricing(args: {
    storeId: string;
    user: UserModel;
    bundleGroupId: string;
    discountType: 'percent' | 'fixed';
    discountValue: number;
    bundleTitle?: string;
  }): Promise<Array<Record<string, unknown>>> {
    const groupId = String(args.bundleGroupId ?? '').trim();
    if (!groupId) return [];

    const rows = await this._cartItemModel
      .find({
        store: new Types.ObjectId(args.storeId),
        user: new Types.ObjectId(args.user.id),
        bundleGroupId: groupId,
      })
      .exec();
    if (!rows.length) return [];

    const lineInputs = await mapInChunks(rows, 4, async (row) => {
      const split = await this.splitCartLineBaseAndExtrasCustomer(
        args.storeId,
        row,
      );
      return {
        lineId: String(row.id),
        baseCustomerPrice: split.baseCustomerPrice,
        extrasCustomerPrice: split.extrasCustomerPrice,
      };
    });

    const allocated = allocateBundleCartLinePrices(
      lineInputs,
      args.discountType,
      args.discountValue,
    );
    const title = String(args.bundleTitle ?? '').trim();

    // Persister prix combo (+ titre figé pour UI / commande).
    await mapInChunks(allocated, 4, async (a) => {
      await this._cartItemModel
        .updateOne(
          { _id: new Types.ObjectId(a.lineId) },
          {
            $set: {
              price: a.unitPrice,
              ...(title ? { bundleTitle: title } : {}),
            },
          },
        )
        .exec();
    });

    void this.bustCartPricingCache(args.user);

    const refreshed = await this._cartItemModel
      .find({
        store: new Types.ObjectId(args.storeId),
        user: new Types.ObjectId(args.user.id),
        bundleGroupId: groupId,
      })
      .lean()
      .exec();

    return (refreshed ?? []).map((r) => {
      const id = String((r as { _id?: unknown })._id ?? '');
      return {
        ...r,
        id,
        _id: id,
      } as Record<string, unknown>;
    });
  }

  /**
   * Sépare prix client catalogue vs extras perso (pour ne pas remettre les extras).
   * Reprend la logique d’ajout panier (variante + commission).
   */
  private async splitCartLineBaseAndExtrasCustomer(
    storeId: string,
    row: CartItemModel,
  ): Promise<{ baseCustomerPrice: number; extrasCustomerPrice: number }> {
    const fullPrice = Math.max(0, Number(row.price) || 0);
    const strategyRaw = String(row.commissionRetrieveStrategy ?? '').trim();
    const strategy =
      strategyRaw === 'add_to_price' || strategyRaw === 'on_payout'
        ? strategyRaw
        : undefined;

    if (row.type === CartItemTypeEnum.DRINK) {
      // Boissons : pas d’extras perso panier → tout est base.
      return { baseCustomerPrice: fullPrice, extrasCustomerPrice: 0 };
    }

    if (row.type !== CartItemTypeEnum.PRODUCT) {
      return { baseCustomerPrice: fullPrice, extrasCustomerPrice: 0 };
    }

    const product = await this._productsService.findOneById(row.entityId);
    if (!product) {
      return { baseCustomerPrice: fullPrice, extrasCustomerPrice: 0 };
    }
    const productObj = (
      typeof (product as { toObject?: () => unknown }).toObject === 'function'
        ? (product as { toObject: () => Record<string, unknown> }).toObject()
        : (product as unknown as Record<string, unknown>)
    ) as Record<string, unknown>;

    let vendorBase = Number(productObj.price ?? 0);
    const variantLabel = String(row.selectedVariantLabel ?? '').trim();
    const variants = Array.isArray(productObj.variants)
      ? productObj.variants
      : [];
    if (variantLabel && variants.length) {
      const match = variants.find((v) => {
        const vrow = (v ?? {}) as Record<string, unknown>;
        return String(vrow.label ?? vrow.name ?? '').trim() === variantLabel;
      }) as Record<string, unknown> | undefined;
      if (match) {
        const vp = Number(match.price ?? 0);
        const vd = Number(match.discountPrice ?? match.discount_price ?? 0);
        vendorBase = vd > 0 && vd < vp ? vd : vp;
      }
    } else {
      const disc = Number(
        productObj.discountPrice ?? productObj.discount_price ?? 0,
      );
      if (disc > 0 && disc < vendorBase) vendorBase = disc;
    }

    const complements = normalizeSelectedComplements(
      row.selectedComplements ?? [],
    );
    const supplements = normalizeSelectedSupplements(
      row.selectedSupplements ?? [],
    );
    const extrasVendor = sumSelectedCustomizationVendorExtras(
      complements,
      supplements,
    );

    if (extrasVendor <= 0) {
      return { baseCustomerPrice: fullPrice, extrasCustomerPrice: 0 };
    }

    // Prix client catalogue seul (sans extras) pour isoler la part remisable.
    const baseCustomerPrice =
      await this._planOrderCommission.resolveCustomerUnitPriceForStore(
        storeId,
        Math.max(0, vendorBase),
        strategy,
      );
    const extrasCustomerPrice = Math.max(
      0,
      roundMoneyCart(fullPrice - baseCustomerPrice),
    );
    return {
      baseCustomerPrice: Math.max(0, baseCustomerPrice),
      extrasCustomerPrice,
    };
  }

  async removeBy(args: RemoveItemFromCartDto): Promise<void> {
    await this._cartItemModel
      .deleteOne({ entityId: args.itemId, type: args.type })
      .exec();
  }

  async removeItemById(id: string, user: UserModel): Promise<void> {
    await this._cartItemModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        user: new Types.ObjectId(user.id),
      })
      .exec();
    await this.bustCartPricingCache(user);
  }

  /** Met à jour la quantité d’une ligne (vérifie que la ligne appartient à l’utilisateur). */
  async setLineQuantity(
    lineId: string,
    quantity: number,
    user: UserModel,
  ): Promise<void> {
    const item = await this._cartItemModel
      .findOne({
        _id: new Types.ObjectId(lineId),
        user: new Types.ObjectId(user.id),
      })
      .populate({ path: 'store', select: '_id' })
      .exec();
    if (!item) {
      throw new NotFoundException('cart_item_not_found');
    }
    const q = Math.max(0, Math.floor(Number(quantity)));
    if (q < 1) {
      throw new BadRequestException('invalid_quantity');
    }
    if (item.type === CartItemTypeEnum.DRINK) {
      const storeId = storeIdFromPopulatedCartItem(item);
      const drink = await this._drinksService.findOneInStoreByIdRaw(
        storeId,
        String(item.entityId ?? ''),
      );
      const maxOrder = drink ? maxDrinkOrderQuantity(drink.quantite) : 0;
      if (!drink || q > maxOrder) {
        throw new BadRequestException('drink_quantity_limit_exceeded');
      }
    }
    await this.updateQuantity(item, q);
    await this.bustCartPricingCache(user);
  }

  async clearStoreCart(store: StoreModel, user: UserModel): Promise<void> {
    await this._cartItemModel
      .deleteMany({
        store: new Types.ObjectId(store.id),
        user: new Types.ObjectId(user.id),
      })
      .exec();
    await this.clearCartMarketingStrategy(user.id, store.id);
    await this.bustCartPricingCache(user);
  }

  async setCartMarketingStrategy(
    userId: string,
    storeId: string,
    listingId: string,
  ): Promise<void> {
    await this._cartMarketingStrategyModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          storeId: new Types.ObjectId(storeId),
        },
        {
          $set: {
            userId: new Types.ObjectId(userId),
            storeId: new Types.ObjectId(storeId),
            listingId: new Types.ObjectId(listingId),
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async getCartMarketingStrategyListingId(
    userId: string,
    storeId: string,
  ): Promise<string | null> {
    const row = await this._cartMarketingStrategyModel
      .findOne({
        userId: new Types.ObjectId(userId),
        storeId: new Types.ObjectId(storeId),
      })
      .select('listingId')
      .lean()
      .exec();
    return row?.listingId ? String(row.listingId) : null;
  }

  async clearCartMarketingStrategy(
    userId: string,
    storeId: string,
  ): Promise<void> {
    await this._cartMarketingStrategyModel
      .deleteOne({
        userId: new Types.ObjectId(userId),
        storeId: new Types.ObjectId(storeId),
      })
      .exec();
  }

  /** Supprime toutes les lignes panier du client (ex. déconnexion). */
  async clearAllForUser(user: UserModel): Promise<void> {
    await this._cartItemModel
      .deleteMany({ user: new Types.ObjectId(user.id) })
      .exec();
    await this._cartMarketingStrategyModel
      .deleteMany({ userId: new Types.ObjectId(user.id) })
      .exec();
    await this.bustCartPricingCache(user);
  }

  /** Valide un code promo pour les lignes panier de l’utilisateur dans une boutique. */
  async previewCouponForStore(
    user: UserModel,
    storeId: string,
    rawCode: string,
  ): Promise<{
    subtotal: number;
    discountAmount: number;
    totalAfterDiscount: number;
    code: string;
    discountType: StoreCouponDiscountTypeEnum;
    value: number;
  }> {
    const coupon = await this._couponsService.getActiveCouponForStore(
      storeId,
      rawCode,
      String(user.id),
    );
    const items = await this._cartItemModel
      .find({
        user: new Types.ObjectId(user.id),
        store: new Types.ObjectId(storeId),
      })
      .exec();
    if (!items?.length) {
      throw new BadRequestException('cart_empty_for_store');
    }
    const subtotal = items.reduce(
      (acc, line) =>
        acc + Number(line.price) * Math.max(1, Number(line.quantity ?? 1)),
      0,
    );
    const discountAmount = this._couponsService.computeDiscountForSubtotal(
      subtotal,
      coupon.discountType,
      coupon.value,
    );
    const total = Math.max(0, subtotal - discountAmount);
    return {
      subtotal,
      discountAmount,
      totalAfterDiscount: Math.round(total * 100 + Number.EPSILON) / 100,
      code: coupon.code,
      discountType: coupon.discountType,
      value: coupon.value,
    };
  }

  /** Valide un gift code plateforme pour le panier multi-boutiques. */
  async previewGiftCodeForCart(user: UserModel, dto: PreviewCartGiftCodeDto) {
    const uid = new Types.ObjectId(user.id);
    const rawItems = await this._cartItemModel.find({ user: uid }).lean().exec();
    if (!rawItems?.length) {
      throw new BadRequestException('cart_empty');
    }

    const byStore = new Map<string, typeof rawItems>();
    for (const row of rawItems) {
      const rawSt = (row as { store?: unknown }).store;
      const sid =
        rawSt != null && typeof rawSt === 'object' && '_id' in (rawSt as object)
          ? String((rawSt as { _id: unknown })._id)
          : String(rawSt ?? '');
      if (!sid || sid === 'undefined') continue;
      if (!byStore.has(sid)) byStore.set(sid, []);
      byStore.get(sid)!.push(row);
    }

    const couponByStore = new Map(
      (dto.coupons ?? []).map(
        (c) =>
          [String(c.storeId), String(c.code ?? '').trim()] as const,
      ),
    );

    const storeInputs: Array<{
      storeId: string;
      storeName: string;
      regionCode: string;
      subtotal: number;
      storeCouponDiscount: number;
    }> = [];

    for (const [storeId, lines] of byStore) {
      const store = await this._storeModel
        .findById(storeId)
        .select('name region')
        .lean()
        .exec();
      const storeName = String((store as { name?: string } | null)?.name ?? '');
      const regionCode = normalizeCountryCode(
        (store as { region?: string } | null)?.region,
      );
      const subtotal = lines.reduce(
        (acc, line) =>
          acc + Number(line.price) * Math.max(1, Number(line.quantity ?? 1)),
        0,
      );
      let storeCouponDiscount = 0;
      const couponCode = couponByStore.get(storeId);
      if (couponCode) {
        try {
          const snap = await this.previewCouponForStore(
            user,
            storeId,
            couponCode,
          );
          storeCouponDiscount = snap.discountAmount;
        } catch {
          storeCouponDiscount = 0;
        }
      }
      storeInputs.push({
        storeId,
        storeName,
        regionCode,
        subtotal,
        storeCouponDiscount,
      });
    }

    return this._giftCodesService.previewForCart(user, dto.code, storeInputs);
  }

  async recordGiftCodeUsageAfterPayment(
    userId: string,
    rawCode: string,
  ): Promise<void> {
    await this._giftCodesService.recordUsageAfterSuccessfulPayment(
      userId,
      rawCode,
    );
  }

  /**
   * Avant paiement : vérifie stocks (menu du jour limité, boissons) et codes promo.
   * Ne modifie pas le panier.
   */
  async validateCheckoutReadiness(
    user: UserModel,
    dto: ValidateCheckoutDto,
  ): Promise<{
    ok: boolean;
    stockIssues: Array<{
      storeId: string;
      storeName: string;
      lineId?: string;
      entityId: string;
      title: string;
      itemType: string;
      quantityRequested: number;
      maxAllowed: number;
      code: string;
    }>;
    couponIssues: Array<{
      storeId: string;
      code: string;
      errorKey: string;
    }>;
    couponWarnings: Array<{
      storeId: string;
      code: string;
      warningKey: string;
      previousDiscountAmount?: number;
      currentDiscountAmount: number;
    }>;
    couponSnapshots: Array<{
      storeId: string;
      code: string;
      subtotal: number;
      discountAmount: number;
      totalAfterDiscount: number;
    }>;
    giftCodeIssue: { code: string; errorKey: string } | null;
    giftCodeWarning: {
      code: string;
      warningKey: string;
      previousDiscountAmount?: number;
      currentDiscountAmount: number;
    } | null;
    giftCodeSnapshot: Awaited<
      ReturnType<CartService['previewGiftCodeForCart']>
    > | null;
  }> {
    const uid = new Types.ObjectId(user.id);
    const preOrderOidByStoreId = dto.preOrderOidByStoreId ?? {};
    const skipStockStoreIds = new Set(
      Object.keys(preOrderOidByStoreId)
        .map((k) => k.trim())
        .filter(Boolean),
    );
    const checkoutStoreFilter = new Set(
      (dto.checkoutStoreIds ?? [])
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const rawItems = await this._cartItemModel
      .find({ user: uid })
      .lean()
      .exec();

    const stockIssues: Array<{
      storeId: string;
      storeName: string;
      lineId?: string;
      entityId: string;
      title: string;
      itemType: string;
      quantityRequested: number;
      maxAllowed: number;
      code: string;
    }> = [];

    if (!rawItems?.length) {
      return {
        ok: true,
        stockIssues: [],
        couponIssues: [],
        couponWarnings: [],
        couponSnapshots: [],
        giftCodeIssue: null,
        giftCodeWarning: null,
        giftCodeSnapshot: null,
      };
    }

    const byStore = new Map<string, (typeof rawItems)[number][]>();
    for (const row of rawItems) {
      const rawSt = (row as { store?: unknown }).store;
      const sid =
        rawSt != null && typeof rawSt === 'object' && '_id' in (rawSt as object)
          ? String((rawSt as { _id: unknown })._id)
          : String(rawSt ?? '');
      if (!sid || sid === 'undefined') continue;
      if (!byStore.has(sid)) byStore.set(sid, []);
      byStore.get(sid)!.push(row);
    }

    for (const [storeId, lines] of byStore) {
      if (
        checkoutStoreFilter.size > 0 &&
        !checkoutStoreFilter.has(storeId)
      ) {
        continue;
      }
      if (skipStockStoreIds.has(storeId)) {
        continue;
      }

      const marketingListingId =
        await this.getCartMarketingStrategyListingId(user.id, storeId);
      let marketingDealProductId: string | null = null;
      if (marketingListingId) {
        const listing = await this._marketingOfferListingModel
          .findById(marketingListingId)
          .select('productId')
          .lean()
          .exec();
        if (listing?.productId) {
          marketingDealProductId = String(listing.productId);
        }
      }

      const store = await this._storeModel
        .findById(storeId)
        .select('dailyMenuByWeekday name region timezone')
        .lean()
        .exec();
      const storeName = String((store as { name?: string } | null)?.name ?? '');
      const effectiveTz = store
        ? await this.resolveStoreEffectiveTimezone(
            store as { timezone?: string; region?: string },
          )
        : undefined;

      const menuRows = Array.isArray(
        (store as { dailyMenuByWeekday?: unknown } | null)?.dailyMenuByWeekday,
      )
        ? ((store as { dailyMenuByWeekday: unknown[] })
            .dailyMenuByWeekday as Record<string, unknown>[])
        : [];

      const productQty = new Map<string, number>();
      for (const line of lines) {
        if (line.type === CartItemTypeEnum.PRODUCT) {
          const pid = String(line.entityId ?? '');
          if (!pid) continue;
          productQty.set(
            pid,
            (productQty.get(pid) ?? 0) +
              Math.max(0, Number(line.quantity ?? 0)),
          );
        }
      }

      for (const [pid, qty] of productQty) {
        if (marketingDealProductId && pid === marketingDealProductId) {
          continue;
        }
        const cap = resolveDailyMenuProductCap(menuRows, pid, effectiveTz);
        if (cap.kind === 'unlimited' || cap.kind === 'no_menu_today') {
          continue;
        }
        const doc = await this._productsService.findOneById(pid);
        const title = String(doc?.title ?? pid);
        if (cap.kind === 'not_on_menu') {
          stockIssues.push({
            storeId,
            storeName,
            entityId: pid,
            title,
            itemType: CartItemTypeEnum.PRODUCT,
            quantityRequested: qty,
            maxAllowed: 0,
            code: 'daily_menu_product_not_available',
          });
          continue;
        }
        if (qty > cap.max) {
          stockIssues.push({
            storeId,
            storeName,
            entityId: pid,
            title,
            itemType: CartItemTypeEnum.PRODUCT,
            quantityRequested: qty,
            maxAllowed: cap.max,
            code:
              cap.max < 1
                ? 'daily_menu_product_not_available'
                : 'daily_menu_insufficient_stock',
          });
        }
      }

      const drinkQty = new Map<string, number>();
      for (const line of lines) {
        if (line.type === CartItemTypeEnum.DRINK) {
          const did = String(line.entityId ?? '');
          if (!did) continue;
          drinkQty.set(
            did,
            (drinkQty.get(did) ?? 0) + Math.max(0, Number(line.quantity ?? 0)),
          );
        }
      }

      for (const [did, qty] of drinkQty) {
        const drink = await this._drinksService.findOneInStoreByIdRaw(
          storeId,
          did,
        );
        const maxOrder = drink ? maxDrinkOrderQuantity(drink.quantite) : 0;
        if (!drink || drink.quantite < qty) {
          stockIssues.push({
            storeId,
            storeName,
            entityId: did,
            title: drink?.name ?? did,
            itemType: CartItemTypeEnum.DRINK,
            quantityRequested: qty,
            maxAllowed: drink ? drink.quantite : 0,
            code: 'drink_insufficient_stock',
          });
        } else if (qty > maxOrder) {
          stockIssues.push({
            storeId,
            storeName,
            entityId: did,
            title: drink.name,
            itemType: CartItemTypeEnum.DRINK,
            quantityRequested: qty,
            maxAllowed: maxOrder,
            code: 'drink_quantity_limit_exceeded',
          });
        }
      }
    }

    const couponIssues: Array<{
      storeId: string;
      code: string;
      errorKey: string;
    }> = [];
    const couponWarnings: Array<{
      storeId: string;
      code: string;
      warningKey: string;
      previousDiscountAmount?: number;
      currentDiscountAmount: number;
    }> = [];
    const couponSnapshots: Array<{
      storeId: string;
      code: string;
      subtotal: number;
      discountAmount: number;
      totalAfterDiscount: number;
    }> = [];

    for (const c of dto.coupons ?? []) {
      const sid = (c.storeId ?? '').trim();
      const code = (c.code ?? '').trim();
      if (!sid || !code) continue;

      try {
        await this._couponsService.getActiveCouponForStore(
          sid,
          code,
          String(user.id),
        );
      } catch (e) {
        couponIssues.push({
          storeId: sid,
          code,
          errorKey: badRequestExceptionKey(e),
        });
        continue;
      }

      try {
        const snap = await this.previewCouponForStore(user, sid, code);
        couponSnapshots.push({
          storeId: sid,
          code: snap.code,
          subtotal: snap.subtotal,
          discountAmount: snap.discountAmount,
          totalAfterDiscount: snap.totalAfterDiscount,
        });
        if (
          c.expectedDiscountAmount != null &&
          Number.isFinite(c.expectedDiscountAmount)
        ) {
          const diff = Math.abs(snap.discountAmount - c.expectedDiscountAmount);
          if (diff > 0.015) {
            couponWarnings.push({
              storeId: sid,
              code: snap.code,
              warningKey: 'discount_amount_changed',
              previousDiscountAmount: c.expectedDiscountAmount,
              currentDiscountAmount: snap.discountAmount,
            });
          }
        }
      } catch (e) {
        couponIssues.push({
          storeId: sid,
          code,
          errorKey: badRequestExceptionKey(e),
        });
      }
    }

    let giftCodeIssue: { code: string; errorKey: string } | null = null;
    let giftCodeWarning: {
      code: string;
      warningKey: string;
      previousDiscountAmount?: number;
      currentDiscountAmount: number;
    } | null = null;
    let giftCodeSnapshot: Awaited<
      ReturnType<CartService['previewGiftCodeForCart']>
    > | null = null;

    const giftRaw = (dto.giftCode ?? '').trim();
    if (giftRaw) {
      try {
        giftCodeSnapshot = await this.previewGiftCodeForCart(user, {
          code: giftRaw,
          coupons: dto.coupons,
        });
        if (
          dto.expectedGiftCodeDiscountAmount != null &&
          Number.isFinite(dto.expectedGiftCodeDiscountAmount)
        ) {
          const diff = Math.abs(
            giftCodeSnapshot.discountAmount -
              dto.expectedGiftCodeDiscountAmount,
          );
          if (diff > 0.015) {
            giftCodeWarning = {
              code: giftCodeSnapshot.code,
              warningKey: 'gift_code_discount_amount_changed',
              previousDiscountAmount: dto.expectedGiftCodeDiscountAmount,
              currentDiscountAmount: giftCodeSnapshot.discountAmount,
            };
          }
        }
      } catch (e) {
        giftCodeIssue = {
          code: giftRaw.toUpperCase(),
          errorKey: badRequestExceptionKey(e),
        };
      }
    }

    const ok =
      stockIssues.length === 0 &&
      couponIssues.length === 0 &&
      giftCodeIssue == null;

    return {
      ok,
      stockIssues,
      couponIssues,
      couponWarnings,
      couponSnapshots,
      giftCodeIssue,
      giftCodeWarning,
      giftCodeSnapshot,
    };
  }
}
