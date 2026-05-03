import { OffersService } from '@modules/offers/offers.service';
import { ProductsService } from '@modules/products/products.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  AddItemToCartDto,
  CartItemApiResponse,
  RemoveItemFromCartDto,
} from './dto/cart.dto';

@Injectable()
export class CartService {
  @InjectModel(CartItemModel.name)
  private readonly _cartItemModel: Model<CartItemModel>;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(OffersService)
  private readonly _offersService: OffersService;

  async findOneByStoreId(
    storeId: string,
    user: UserModel,
  ): Promise<CartItemApiResponse> {
    const items = await this._cartItemModel
      .find({ store: new Types.ObjectId(storeId), user: new Types.ObjectId(user.id) })
      .populate('store')
      .exec();

    if (!items?.length) {
      throw new NotFoundException('cart_not_found');
    }

    const mappedItems: Partial<CartItemModel>[] = (
      await Promise.all(
        items.map(async (item) => await this.findOneByItemId(item.id, user)),
      )
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
      .populate('store')
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
        {
          path: 'store',
        },
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

    return {
      data: await Promise.all(
        Object.values(formatedItems).map(async (item) => {
          const items = (
            await Promise.all(
              (item.items ?? []).map((item) =>
                this.findOneByItemId(item._id.toString(), user),
              ),
            )
          ).map(({ store, ...rest }) => {
            return rest;
          });

          return {
            store: item.store,
            items,
            totalPrice: items.reduce(
              (acc, item) => acc + item.price * item.quantity,
              0,
            ),
          };
        }),
      ),
    };

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
    let item = await this.itemExistsInCart(store, args, user);
    if (item) {
      await this.updateQuantity(item, (item.quantity ?? 0) + args.quantity);
    } else {
      item = await this._cartItemModel.create({
        user: new Types.ObjectId(user.id),
        store: new Types.ObjectId(store.id),
        entityId: args.itemId,
        ...(args.type === CartItemTypeEnum.PRODUCT_EXTRA && {
          productId: args.productId,
        }),
        type: args.type,
        quantity: +(args.quantity ?? 1),
        price: args.price,
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

  async clearStoreCart(store: StoreModel, user: UserModel): Promise<void> {
    await this._cartItemModel
      .deleteMany({
        store: new Types.ObjectId(store.id),
        user: new Types.ObjectId(user.id),
      })
      .exec();
  }
}
