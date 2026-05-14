import { CartService } from '@modules/cart/cart.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ProductsService } from '@modules/products/products.service';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import {
  OrdeLineItem,
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { haversineDistance } from 'src/utils/helpers';
import { mapInChunks } from '@utils/map-in-chunks';
import { FilterOrdersDto } from './dto/orders.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @Inject(CartService)
  private readonly _cartService: CartService;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(NotificationsService)
  private readonly _notificationsService: NotificationsService;

  private storeOwnerUserIdFromLean(store: unknown): string | null {
    if (!store || typeof store !== 'object' || !('owner' in store)) {
      return null;
    }
    const o = (store as { owner?: unknown }).owner;
    if (o instanceof Types.ObjectId) {
      return o.toHexString();
    }
    if (o && typeof o === 'object' && o !== null && '_id' in o) {
      const id = (o as { _id: unknown })._id;
      if (id instanceof Types.ObjectId) {
        return id.toHexString();
      }
      if (id != null && Types.ObjectId.isValid(String(id))) {
        return String(id);
      }
    }
    return null;
  }

  /**
   * Restreint `filter.store` aux boutiques dont le nom correspond à `q`.
   * @returns `empty` si aucune boutique ne correspond ou si l’intersection avec le filtre courant est vide.
   */
  private async applyStoreNameSearch(
    filter: Record<string, unknown>,
    qRaw: string | undefined,
  ): Promise<'ok' | 'empty'> {
    const q = qRaw?.trim();
    if (!q) {
      return 'ok';
    }
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(esc, 'i');
    const matching = await this._storeModel
      .find({ name: rx })
      .select('_id')
      .limit(500)
      .lean()
      .exec();
    const matchIds = matching.map((s) => String(s._id));
    if (!matchIds.length) {
      return 'empty';
    }

    const cur = filter['store'];
    if (cur == null) {
      filter['store'] = {
        $in: matchIds.map((id) => new Types.ObjectId(id)),
      };
      return 'ok';
    }
    if (typeof cur === 'object' && cur !== null && '_id' in cur) {
      const sid = (cur as { _id: unknown })._id;
      const idStr =
        sid instanceof Types.ObjectId ? sid.toHexString() : String(sid);
      if (!matchIds.includes(idStr)) {
        return 'empty';
      }
      return 'ok';
    }
    if (typeof cur === 'object' && cur !== null && '$in' in cur) {
      const arr = (cur as { $in: unknown[] }).$in;
      const narrowed = arr.filter((oid) => {
        const idStr =
          oid instanceof Types.ObjectId
            ? oid.toHexString()
            : String(oid);
        return matchIds.includes(idStr);
      });
      if (!narrowed.length) {
        return 'empty';
      }
      filter['store'] = { $in: narrowed };
      return 'ok';
    }

    filter['store'] = {
      $in: matchIds.map((id) => new Types.ObjectId(id)),
    };
    return 'ok';
  }

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
      filter['user'] = new Types.ObjectId(String(user.id));
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    }

    if (args.status) {
      filter['status'] = args.status;
    }

    const search = await this.applyStoreNameSearch(filter, args.q);
    if (search === 'empty') {
      return { data: [] };
    }

    /** Liste mobile / admin : plafond par défaut (évite charger tout l’historique + populate profond). */
    const lim =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(200, Math.max(1, args.limit))
        : 80;

    const skip =
      typeof args.skip === 'number' && args.skip > 0
        ? Math.min(10_000, Math.max(0, Math.floor(args.skip)))
        : 0;

    const data = await this._orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate({
        path: 'store',
        select:
          'name profileImage status currency acceptsOrders supportsShipping bio',
      })
      .populate({
        path: 'user',
        select: 'fullName email profileImage',
      })
      .lean()
      .exec();

    return { data: data as unknown as OrderModel[] };
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
      filter['user'] = new Types.ObjectId(String(user.id));
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

    const items: OrdeLineItem[] = await mapInChunks(cart.items, 4, async (item) => {
      const e = item.entity as
        | { title?: string; name?: string; profileImage?: string }
        | undefined;
      const label = (e?.title || e?.name || 'Article').trim() || 'Article';
      return {
        label,
        itemType: item.type!,
        pictureUrl: e?.profileImage,
        quantity: item.quantity!,
        price: item.price!,
        categoryTitle: await this.categoryTitleForCartLine(item),
      };
    });

    const calculatedPrice = items.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );

    const order = await this._orderModel.create({
      status: OrderStatusEnum.CREATED,
      store: new Types.ObjectId(String(storeId)),
      user: new Types.ObjectId(String(user.id)),
      items,
      totalPrice: calculatedPrice, // TODO should we add shipping price here?
      shippingPrice: 0,
    });

    const created = await this.findOneById(order._id.toString(), user);
    const storePop = created.store as { name?: string } | null | undefined;
    await this._notificationsService.pushCustomerOrderCreated({
      userId: String(user.id),
      orderId: created._id.toString(),
      storeName: storePop?.name?.trim() || undefined,
      storeId: String(storeId),
    });

    const sto = await this._storeModel
      .findById(new Types.ObjectId(String(storeId)))
      .select('owner name')
      .lean()
      .exec();
    const ownerId = this.storeOwnerUserIdFromLean(sto);
    if (ownerId && ownerId !== String(user.id)) {
      const sname = (sto as { name?: string } | null)?.name?.trim();
      void this._notificationsService
        .pushVendorOrderNotify({
          vendorUserIds: [ownerId],
          title: 'Nouvelle commande',
          body: `${sname || 'Boutique'} : nouvelle commande (en attente de paiement).`,
          orderId: created._id.toString(),
          storeName: sname,
          reason: 'new_order',
          status: OrderStatusEnum.CREATED,
        })
        .catch((err) =>
          this.logger.warn(
            `FCM vendor new order: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }
    return created;
  }

  /**
   * Après paiement Stripe : statut payé + frais + total.
   * Si `opts.charged*Cents` sont fournis (métadonnées Stripe / payout), le total
   * suit le montant réellement encaissé (ex. panier avec code promo).
   */
  async markOrderPaidWithShipping(
    orderId: string,
    shippingPrice: number,
    opts?: {
      stripeParentPaymentId?: string;
      couponCode?: string;
      chargedGoodsCents?: number;
      chargedShipCents?: number;
    },
  ): Promise<void> {
    const ship = Math.max(0, Number(shippingPrice) || 0);
    const o = await this._orderModel
      .findById(new Types.ObjectId(orderId))
      .populate('store', 'name owner')
      .lean()
      .exec();
    if (!o?.items?.length) return;
    const prevStatus = String(o.status ?? '');
    const goods = (o.items as OrdeLineItem[]).reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );

    const gC =
      opts?.chargedGoodsCents != null && Number.isFinite(opts.chargedGoodsCents)
        ? Math.max(0, Math.round(opts.chargedGoodsCents))
        : null;
    const sC =
      opts?.chargedShipCents != null && Number.isFinite(opts.chargedShipCents)
        ? Math.max(0, Math.round(opts.chargedShipCents))
        : null;

    let totalPrice: number;
    let shippingStored: number;
    if (gC != null && sC != null) {
      totalPrice = Math.round((gC + sC + Number.EPSILON)) / 100;
      shippingStored = sC / 100;
    } else {
      shippingStored = ship;
      totalPrice =
        Math.round((goods + shippingStored) * 100 + Number.EPSILON) / 100;
    }

    const $set: Record<string, unknown> = {
      status: OrderStatusEnum.PAIED,
      shippingPrice: shippingStored,
      totalPrice,
    };
    if (opts?.stripeParentPaymentId?.trim()) {
      $set['stripeParentPaymentId'] = opts.stripeParentPaymentId.trim();
    }
    if (opts?.couponCode?.trim()) {
      $set['couponCode'] = opts.couponCode.trim().toUpperCase();
    }
    if (gC != null) {
      $set['stripeChargedGoodsCents'] = gC;
    }
    if (sC != null) {
      $set['stripeChargedShipCents'] = sC;
    }

    await this._orderModel
      .updateOne({ _id: new Types.ObjectId(orderId) }, { $set })
      .exec();

    if (prevStatus !== OrderStatusEnum.PAIED) {
      const rawUser = o.user as
        | Types.ObjectId
        | { _id?: Types.ObjectId }
        | null
        | undefined;
      let uid: string | null = null;
      if (rawUser instanceof Types.ObjectId) {
        uid = rawUser.toHexString();
      } else if (
        rawUser &&
        typeof rawUser === 'object' &&
        '_id' in rawUser &&
        rawUser._id instanceof Types.ObjectId
      ) {
        uid = rawUser._id.toHexString();
      } else if (rawUser != null) {
        uid = String(rawUser);
      }
      let storeName: string | undefined;
      let storeIdForNotif: string | undefined;
      const rawStore = o.store as unknown;
      if (rawStore && typeof rawStore === 'object' && rawStore !== null) {
        const stObj = rawStore as { _id?: unknown; name?: unknown };
        const nm = stObj.name;
        if (typeof nm === 'string' && nm.trim()) {
          storeName = nm.trim();
        }
        const sid = stObj._id;
        if (sid instanceof Types.ObjectId) {
          storeIdForNotif = sid.toHexString();
        } else if (typeof sid === 'string' && Types.ObjectId.isValid(sid)) {
          storeIdForNotif = sid;
        }
      }
      if (uid && Types.ObjectId.isValid(uid)) {
        void this._notificationsService
          .pushCustomerOrderStatusChanged({
            userId: uid,
            orderId,
            storeName,
            storeId: storeIdForNotif,
            previousStatus: prevStatus,
            newStatus: OrderStatusEnum.PAIED,
          })
          .catch((err) =>
            this.logger.warn(
              `FCM order paid: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        const ownerId = this.storeOwnerUserIdFromLean(o.store);
        if (ownerId && ownerId !== uid) {
          void this._notificationsService
            .pushVendorOrderNotify({
              vendorUserIds: [ownerId],
              title: 'Commande payée',
              body: `${storeName ?? 'Boutique'} : la commande a été payée.`,
              orderId,
              storeName,
              reason: 'order_paid',
              status: OrderStatusEnum.PAIED,
            })
            .catch((err) =>
              this.logger.warn(
                `FCM vendor order paid: ${err instanceof Error ? err.message : String(err)}`,
              ),
            );
        }
      }
    }
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
    if (type === CartItemTypeEnum.DRINK) {
      return 'Boisson';
    }
    return undefined;
  }
}
