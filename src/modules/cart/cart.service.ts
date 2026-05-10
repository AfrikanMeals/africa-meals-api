import { CouponsService } from '@modules/coupons/coupons.service';
import { DrinksService } from '@modules/drinks/drinks.service';
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

/** Forme proche d’un produit pour les clients (ex. app mobile `Entity`). */
function drinkEntityForCartApi(drink: {
  id: string;
  name: string;
  description: string;
  priceCad: number;
  imageUrl?: string;
  createdAt?: string;
  updatedAt?: string;
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
  };
}

@Injectable()
export class CartService {
  @InjectModel(CartItemModel.name)
  private readonly _cartItemModel: Model<CartItemModel>;

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
      return {
        ...item.toJSON(),
        entity: product,
      };
    } else if (item.type === CartItemTypeEnum.DRINK) {
      const storeId = storeIdFromPopulatedCartItem(item);
      const drink = await this._drinksService.findOneInStoreCatalog(
        storeId,
        item.entityId,
      );
      if (!drink) {
        throw new NotFoundException('drink_not_found');
      }
      return {
        ...item.toJSON(),
        entity: drinkEntityForCartApi(drink),
      };
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
      if (drink.quantite < newTotalQty) {
        throw new BadRequestException('drink_insufficient_stock');
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
      .exec();
    if (!item) {
      throw new NotFoundException('cart_item_not_found');
    }
    await this.updateQuantity(item, quantity);
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
}
