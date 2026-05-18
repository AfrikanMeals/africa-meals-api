import { CouponsService } from '@modules/coupons/coupons.service';
import {
  DrinksService,
  maxDrinkOrderQuantity,
} from '@modules/drinks/drinks.service';
import { OffersService } from '@modules/offers/offers.service';
import { ProductsService } from '@modules/products/products.service';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import {
  StoreCouponDiscountTypeEnum,
} from '@schemas/store_coupon.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  AddItemToCartDto,
  CartItemApiResponse,
  RemoveItemFromCartDto,
  ValidateCheckoutDto,
} from './dto/cart.dto';
import { mapInChunks } from '@utils/map-in-chunks';

/** Boutique + adresse géolocalisée (distance client ↔ restaurant sur le mobile). */
const cartStorePopulate = {
  path: 'store',
  populate: {
    path: 'address',
    select: 'address city country zipCode countryCode location label',
  },
} as const;

function storeIdFromPopulatedCartItem(item: {
  store?: unknown;
}): string {
  const s = item.store;
  if (s && typeof s === 'object') {
    const o = s as { _id?: unknown; id?: unknown };
    if (o._id != null) {
      return String(o._id);
    }
    if (o.id != null) {
      return String(o.id);
    }
  }
  return '';
}

/**
 * Stock menu du jour restant pour un produit (null = illimité ou hors menu du jour limité).
 */
function dailyMenuStockRemainingForStoreProduct(
  store: { dailyMenuByWeekday?: unknown },
  productId: string,
): number | null {
  const dow = new Date().getDay();
  const rows = Array.isArray(store.dailyMenuByWeekday)
    ? store.dailyMenuByWeekday
    : [];
  const slot = (rows as { dayOfWeek?: number; items?: unknown[] }[]).find(
    (r) => Number(r?.dayOfWeek) === dow,
  );
  const items = Array.isArray(slot?.items) ? slot!.items : [];
  const pid = String(productId);
  const it = (items as Record<string, unknown>[]).find((x) => {
    const id = x['productId'];
    if (id != null && typeof id === 'object' && 'toString' in id) {
      return (id as Types.ObjectId).toString() === pid;
    }
    return String(id) === pid;
  });
  if (!it) return null;
  if (it['stockUnlimited'] !== false) return null;
  return Math.max(0, Math.floor(Number(it['stockRemaining'] ?? 0)));
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

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(OffersService)
  private readonly _offersService: OffersService;

  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  @Inject(CouponsService)
  private readonly _couponsService: CouponsService;

  async findOneByStoreId(
    storeId: string,
    user: UserModel,
  ): Promise<CartItemApiResponse> {
    const items = await this._cartItemModel
      .find({ store: new Types.ObjectId(storeId), user: new Types.ObjectId(user.id) })
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
      const st = item.store as { dailyMenuByWeekday?: unknown };
      const dailyMenuStockRemaining = dailyMenuStockRemainingForStoreProduct(
        st,
        item.entityId,
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
        entity: drinkEntityForCartApi(drink),
        drinkMaxOrderQuantity: maxOrder,
      } as unknown as Partial<CartItemModel>;
    } else {
      const product = await this._productsService.findOneById(item.productId);
      // console.log('🚀 ~ CartService ~ product:', product);
      if (!product) {
        throw new NotFoundException('product_not_found');
      }

      const extra = product.extras.find((e) => e.id === item.entityId);
      if (!extra) {
        throw new NotFoundException('extra_not_found');
      }
      return {
        ...item.toJSON(),
        entity: extra,
      };
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
        if (!acc[item.store.id]) {
          acc[item.store.id] = {
            store: item.store,
            items: [],
          };
        }
        acc[item.store.id].items.push(item);
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
    const data = await mapInChunks(storeGroups, 2, async (group) => {
      const lineItems = await mapInChunks(
        group.items ?? [],
        4,
        (line) => this.findOneByItemId(line._id.toString(), user),
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

  async itemExistsInCart(
    store: StoreModel,
    args: AddItemToCartDto,
    user: UserModel,
  ): Promise<CartItemModel> {
    return await this._cartItemModel
      .findOne({
        entityId: args.itemId,
        type: args.type,
        user: new Types.ObjectId(user.id),
        store: new Types.ObjectId(store.id),
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
      (acc, r) => acc + Math.max(0, Number((r as { quantity?: number }).quantity ?? 0)),
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

    if (args.type === CartItemTypeEnum.DRINK) {
      const drink = await this._drinksService.findOneInStoreCatalog(
        store.id,
        args.itemId,
      );
      if (!drink) {
        throw new NotFoundException('drink_not_found');
      }
      priceForLine = drink.priceCad;
      const existing = await this.itemExistsInCart(store, args, user);
      const newTotalQty = (existing?.quantity ?? 0) + qtyReq;
      const maxOrder = maxDrinkOrderQuantity(drink.quantite);
      if (newTotalQty > maxOrder) {
        throw new BadRequestException('drink_quantity_limit_exceeded');
      }
    }

    let item = await this.itemExistsInCart(store, args, user);
    if (item) {
      await this.updateQuantity(item, (item.quantity ?? 0) + qtyReq);
      if (args.type === CartItemTypeEnum.DRINK) {
        await this._cartItemModel
          .updateOne({ _id: item.id }, { $set: { price: priceForLine } })
          .exec();
      }
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
      });
    }

    return await this.findOneByItemId(item.id, user);
  }

  async removeBy(args: RemoveItemFromCartDto): Promise<void> {
    await this._cartItemModel
      .deleteOne({ entityId: args.itemId, type: args.type })
      .exec();
  }

  async removeItemById(id: string, user: UserModel): Promise<void> {
    await this._cartItemModel
      .deleteOne({ _id: new Types.ObjectId(id), user: new Types.ObjectId(user.id) })
      .exec();
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
      const maxOrder = drink
        ? maxDrinkOrderQuantity(drink.quantite)
        : 0;
      if (!drink || q > maxOrder) {
        throw new BadRequestException('drink_quantity_limit_exceeded');
      }
    }
    await this.updateQuantity(item, q);
  }

  async clearStoreCart(store: StoreModel, user: UserModel): Promise<void> {
    await this._cartItemModel
      .deleteMany({
        store: new Types.ObjectId(store.id),
        user: new Types.ObjectId(user.id),
      })
      .exec();
  }

  /** Supprime toutes les lignes panier du client (ex. déconnexion). */
  async clearAllForUser(user: UserModel): Promise<void> {
    await this._cartItemModel
      .deleteMany({ user: new Types.ObjectId(user.id) })
      .exec();
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
      totalAfterDiscount:
        Math.round(total * 100 + Number.EPSILON) / 100,
      code: coupon.code,
      discountType: coupon.discountType,
      value: coupon.value,
    };
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
  }> {
    const uid = new Types.ObjectId(user.id);
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
      const store = await this._storeModel
        .findById(storeId)
        .select('dailyMenuByWeekday name')
        .lean()
        .exec();
      const storeName = String(
        (store as { name?: string } | null)?.name ?? '',
      );

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
        const maxRem = dailyMenuStockRemainingForStoreProduct(
          (store ?? {}) as { dailyMenuByWeekday?: unknown },
          pid,
        );
        if (maxRem != null && qty > maxRem) {
          const doc = await this._productsService.findOneById(pid);
          const title = String(doc?.title ?? pid);
          stockIssues.push({
            storeId,
            storeName,
            entityId: pid,
            title,
            itemType: CartItemTypeEnum.PRODUCT,
            quantityRequested: qty,
            maxAllowed: maxRem,
            code: 'daily_menu_insufficient_stock',
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
            (drinkQty.get(did) ?? 0) +
              Math.max(0, Number(line.quantity ?? 0)),
          );
        }
      }

      for (const [did, qty] of drinkQty) {
        const drink = await this._drinksService.findOneInStoreByIdRaw(
          storeId,
          did,
        );
        const maxOrder = drink
          ? maxDrinkOrderQuantity(drink.quantite)
          : 0;
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
        await this._couponsService.getActiveCouponForStore(sid, code);
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
          const diff = Math.abs(
            snap.discountAmount - c.expectedDiscountAmount,
          );
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

    const ok =
      stockIssues.length === 0 && couponIssues.length === 0;

    return {
      ok,
      stockIssues,
      couponIssues,
      couponWarnings,
      couponSnapshots,
    };
  }
}
