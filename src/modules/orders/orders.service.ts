import { CartService } from '@modules/cart/cart.service';
import { ProductsService } from '@modules/products/products.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import {
  OrdeLineItem,
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { haversineDistance } from 'src/utils/helpers';
import { FilterOrdersDto } from './dto/orders.dto';

@Injectable()
export class OrdersService {
  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @Inject(CartService)
  private readonly _cartService: CartService;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  async filter(
    args: FilterOrdersDto,
    user: UserModel,
  ): Promise<{ data: OrderModel[] }> {
    const filter: Record<string, unknown> = {};

    if (user.type === UserTypeEnum.ADMIN) {
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    } else if (user.type === UserTypeEnum.VENDOR) {
      const rawStores = user.stores || [];
      const storeIds = rawStores.map((s: unknown) => {
        if (typeof s === 'object' && s !== null && '_id' in s) {
          return String((s as { _id: { toString: () => string } })._id);
        }
        return String(s);
      });
      if (!storeIds.length) {
        return { data: [] };
      }
      if (args.storeId) {
        if (!storeIds.includes(args.storeId)) {
          return { data: [] };
        }
        filter['store'] = { _id: args.storeId };
      } else {
        filter['store'] = { $in: storeIds };
      }
    } else {
      filter['user'] = { _id: user.id };
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    }

    if (args.status) {
      filter['status'] = args.status;
    }

    let query = this._orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .populate('store')
      .populate({
        path: 'user',
        select: 'fullName email profileImage addresses',
        populate: { path: 'addresses' },
      });

    if (typeof args.limit === 'number' && args.limit > 0) {
      query = query.limit(args.limit);
    }

    const data = await query.exec();

    return { data };
  }

  async findOneById(id: string, user: UserModel) {
    const filter: Record<string, unknown> = { _id: id };

    if (user.type === UserTypeEnum.ADMIN) {
      // accès à toute commande
    } else if (user.type === UserTypeEnum.VENDOR) {
      const rawStores = user.stores || [];
      const storeIds = rawStores.map((s: unknown) => {
        if (typeof s === 'object' && s !== null && '_id' in s) {
          return String((s as { _id: { toString: () => string } })._id);
        }
        return String(s);
      });
      if (!storeIds.length) {
        throw new NotFoundException('order_not_found');
      }
      filter['store'] = { $in: storeIds };
    } else {
      filter['user'] = { _id: user.id };
    }

    const order = await this._orderModel
      .findOne(filter)
      .populate({
        path: 'store',
        populate: [
          {
            path: 'address',
          },
        ],
      })
      .populate('user', 'fullName email profileImage addresses')
      .exec();

    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    return order;
  }

  async createFromCart(storeId: string, user: UserModel) {
    const cart = await this._cartService.findOneByStoreId(storeId, user);

    if (!cart?.items?.length) {
      throw new NotFoundException('cart_is_empty');
    }
    // const store = cart.store;

    // if (!store?.acceptsOrders) {
    //   throw new ForbiddenException('store_does_not_accept_orders');
    // }

    const items: OrdeLineItem[] = await Promise.all(
      cart.items.map(async (item) => ({
        label: item.entity?.title ?? 'Article',
        itemType: item.type!,
        pictureUrl: item.entity?.profileImage,
        quantity: item.quantity!,
        price: item.price!,
        categoryTitle: await this.categoryTitleForCartLine(item),
      })),
    );

    const calculatedPrice = items.reduce((acc, item) => acc + item.price, 0);

    const order = await this._orderModel.create({
      status: OrderStatusEnum.CREATED,
      store: {
        _id: storeId,
      },
      user: {
        _id: user.id,
      },
      items,
      totalPrice: calculatedPrice, // TODO should we add shipping price here?
      shippingPrice: 0,
    });

    return this.findOneById(order._id.toString(), user);
  }

  async calculateShippingPrice(orderId: string, user: UserModel) {
    const order = await this.findOneById(orderId, user);
    // console.log(
    //   '🚀 ~ OrdersService ~ calculateShippingPrice ~ order:',
    //   JSON.stringify(order),
    // );

    const shippingZones = order.store.shippingZones;
    const store = order.store;

    if (!store.supportsShipping) {
      return {
        price: 0,
        distance: 0,
      };
    }

    if (!shippingZones?.length) {
      throw new NotFoundException('store_shipping_zones_not_found');
    }

    const storeAddress = order.store.address;
    if (!storeAddress) {
      throw new NotFoundException('store_address_not_found');
    }

    const usersAddress =
      (user.addresses || []).find((a) => a.isDefault) || user.addresses[0];
    if (!usersAddress) {
      throw new NotFoundException('user_address_not_found');
    }

    // Calculate distance between store and users address
    const distance = +haversineDistance(
      usersAddress.location.coordinates as [number, number],
      store.address.location.coordinates as [number, number],
    )?.toFixed(2);

    console.log(
      '🚀 ~ OrdersService ~ calculateShippingPrice ~ distance:',
      usersAddress.address + (usersAddress.id ? ` (${usersAddress.id})` : ''),
      '=>',
      store.address.address + ` (${store.address.id})`,
    );
    const shippingZone = shippingZones.find(
      (zone) => zone.minDistance <= distance && zone.maxDistance >= distance,
    );

    if (!shippingZone) {
      const maxShippingZone = shippingZones.sort(
        (a, b) => b.maxDistance - a.maxDistance,
      )[0];

      if (maxShippingZone.minDistance <= distance) {
        throw new NotFoundException('out_of_shipping_zone');
      }

      throw new NotFoundException('shipping_zone_not_found');
    }

    return {
      price: shippingZone.price,
      label: shippingZone.label,
      distance,
    };
  }

  /** Catégorie du menu au moment de l’achat (libellé produit / offre). */
  private async categoryTitleForCartLine(
    item: Partial<CartItemModel> & {
      entity?: { title?: string; profileImage?: string; category?: unknown };
    },
  ): Promise<string | undefined> {
    const type = item.type;
    if (!type) {
      return undefined;
    }
    if (type === CartItemTypeEnum.PRODUCT) {
      const cat = item.entity?.category;
      if (
        cat &&
        typeof cat === 'object' &&
        cat !== null &&
        'title' in cat &&
        typeof (cat as { title?: unknown }).title === 'string'
      ) {
        return (cat as { title: string }).title;
      }
      return undefined;
    }
    if (type === CartItemTypeEnum.PRODUCT_EXTRA && item.productId) {
      const p = await this._productsService.findOneById(String(item.productId));
      const cat = p?.category as { title?: string } | undefined;
      return cat?.title;
    }
    if (type === CartItemTypeEnum.OFFER) {
      return 'Offre';
    }
    return undefined;
  }
}
