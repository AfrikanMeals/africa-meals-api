import { CartService } from '@modules/cart/cart.service';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  OrdeLineItem,
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { haversineDistance } from 'src/utils/helpers';
import { FilterOrdersDto } from './dto/orders.dto';

@Injectable()
export class OrdersService {
  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @Inject(CartService)
  private readonly _cartService: CartService;

  async filter(
    args: FilterOrdersDto,
    user: UserModel,
  ): Promise<{ data: OrderModel[] }> {
    const filter = { user: { _id: user.id } };
    if (args.storeId) {
      filter['store'] = { _id: args.storeId };
    }

    if (args.status) {
      filter['status'] = args.status;
    }
    return {
      data: await this._orderModel.find(filter).populate('store').exec(),
    };
  }

  async findOneById(id: string, user: UserModel) {
    const order = await this._orderModel
      .findOne({ _id: id, user: { _id: user.id } })
      .populate({
        path: 'store',
        populate: [
          {
            path: 'address',
          },
          // {
          //   path: 'shippingZones',
          // },
        ],
      })
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

    const items: OrdeLineItem[] = cart.items.map((item) => ({
      label: item.entity.title,
      itemType: item.type,
      pictureUrl: item.entity.profileImage,
      quantity: item.quantity,
      price: item.price,
    }));

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
}
