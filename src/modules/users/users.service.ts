import { AddressesService } from '@modules/addresses/addresses.service';
import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AddressTypeEnum } from '@schemas/address.schema';
import { OrderModel } from '@schemas/order.schema';
import { PaymentMethodModel } from '@schemas/payment-method.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

@Injectable()
export class UsersService {
  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @Inject(AddressesService)
  private readonly _addressesService: AddressesService;

  async createAddress(args: CreateAddressDto, authUser: UserModel) {
    const user = await this._userModel
      .findById(authUser._id)
      .populate('addresses')
      .exec();

    if (!user) {
      throw new NotFoundException('user_not_found');
    }

    const isFirstAddress = !user.addresses?.length;
    const address = await this._addressesService.create(
      {
        ...args,
        isDefault: isFirstAddress,
        type: AddressTypeEnum.USER,
      },
      user,
    );

    if (!address) {
      throw new BadRequestException('address_not_found');
    }

    await this._userModel.updateOne(
      { _id: user._id },
      { $push: { addresses: address._id } },
    );
    return address;
  }

  async findById(id: string) {
    const user = await this._userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException('user_not_found');
    }
    return user;
  }

  /**
   * Liste des comptes `USER` (clients finaux), sans champs sensibles.
   * - `ADMIN` : tous les clients ; `ordersCount` = nombre total de commandes (toutes boutiques).
   * - `VENDOR` : clients ayant au moins une commande sur une boutique dont le propriétaire est l’appelant ;
   *   `ordersCount` = nombre de commandes chez ce vendeur (toutes ses boutiques).
   */
  async listEndUserClients(caller: UserModel) {
    if (!caller) {
      throw new ForbiddenException('clients_access_denied');
    }
    if (caller.type === UserTypeEnum.ADMIN) {
      return this._listAllEndUserClients();
    }
    if (caller.type === UserTypeEnum.VENDOR) {
      return this._listEndUserClientsForVendorStores(caller);
    }
    throw new ForbiddenException('clients_access_denied');
  }

  private async _orderCountsByUser(
    userIds: Types.ObjectId[],
    storeFilter?: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!userIds.length) {
      return map;
    }
    const match: Record<string, unknown> = { user: { $in: userIds } };
    if (storeFilter?.length) {
      match.store = { $in: storeFilter };
    }
    const agg = await this._orderModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: match },
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ])
      .exec();
    for (const row of agg) {
      map.set(String(row._id), row.count);
    }
    return map;
  }

  private _mapLeanUserToClientRow(
    u: Record<string, unknown>,
    ordersCount: number,
  ) {
    const id = String(u._id);
    const fullName = String(u.fullName ?? u.full_name ?? '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const prenom = parts.length > 1 ? parts[0] : '';
    const nom =
      parts.length > 1 ? parts.slice(1).join(' ') : parts[0] ?? '';

    const rawAddresses = u.addresses as Record<string, unknown>[] | undefined;
    const addresses = Array.isArray(rawAddresses) ? rawAddresses : [];
    const defaultAddr =
      addresses.find((a) => a?.isDefault === true) ?? addresses[0];
    let addressSummary = '';
    if (defaultAddr && typeof defaultAddr.address === 'string') {
      const city =
        typeof defaultAddr.city === 'string' ? defaultAddr.city : '';
      addressSummary = city
        ? `${defaultAddr.address}, ${city}`
        : defaultAddr.address;
    }

    const createdRaw = u.createdAt ?? u.created_at;
    const created =
      createdRaw instanceof Date
        ? createdRaw
        : new Date(String(createdRaw ?? Date.now()));

    const verifiedRaw = u.emailVerifiedAt ?? u.email_verified_at;
    const emailVerified =
      verifiedRaw instanceof Date ||
      (typeof verifiedRaw === 'string' && verifiedRaw.length > 0);

    return {
      id,
      fullName: fullName || nom || prenom,
      prenom,
      nom,
      email: String(u.email ?? ''),
      appCountryCode: String(u.appCountryCode ?? u.app_country_code ?? ''),
      loyaltyPoints: Number(u.loyaltyPoints ?? u.loyalty_points ?? 0),
      createdAt: created.toISOString(),
      addressSummary,
      emailVerified,
      ordersCount,
    };
  }

  private async _listAllEndUserClients() {
    const rows = await this._userModel
      .find({ type: UserTypeEnum.USER })
      .select(
        'fullName email appCountryCode emailVerifiedAt loyaltyPoints createdAt addresses',
      )
      .populate({
        path: 'addresses',
        select: 'address city label isDefault',
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const userIds = rows.map(
      (r) => r._id as Types.ObjectId,
    );
    const counts = await this._orderCountsByUser(userIds);

    return (rows as Record<string, unknown>[]).map((u) =>
      this._mapLeanUserToClientRow(
        u,
        counts.get(String(u._id)) ?? 0,
      ),
    );
  }

  private async _listEndUserClientsForVendorStores(caller: UserModel) {
    const stores = await this._storeModel
      .find({ owner: caller._id })
      .select('_id')
      .lean()
      .exec();

    const storeIds = stores.map((s) => s._id as Types.ObjectId);
    if (!storeIds.length) {
      return [];
    }

    const distinctUsers = await this._orderModel.distinct('user', {
      store: { $in: storeIds },
    });

    const userIds: Types.ObjectId[] = [];
    for (const raw of distinctUsers as (Types.ObjectId | string)[]) {
      if (raw instanceof Types.ObjectId) {
        userIds.push(raw);
      } else if (typeof raw === 'string' && Types.ObjectId.isValid(raw)) {
        userIds.push(new Types.ObjectId(raw));
      }
    }

    if (!userIds.length) {
      return [];
    }

    const rows = await this._userModel
      .find({
        _id: { $in: userIds },
        type: UserTypeEnum.USER,
      })
      .select(
        'fullName email appCountryCode emailVerifiedAt loyaltyPoints createdAt addresses',
      )
      .populate({
        path: 'addresses',
        select: 'address city label isDefault',
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const counts = await this._orderCountsByUser(userIds, storeIds);

    return (rows as Record<string, unknown>[]).map((u) =>
      this._mapLeanUserToClientRow(
        u,
        counts.get(String(u._id)) ?? 0,
      ),
    );
  }

  async hasStore(authUser: UserModel) {
    const user = await this._userModel
      .findById(authUser._id)
      .populate('stores')
      .exec();

    return user.stores.length;
  }

  async addStore(store: StoreModel, authUser: UserModel) {
    // TODO users have only one store for now
    const hasStore = await this.hasStore(authUser);
    if (hasStore) {
      throw new ConflictException('user_has_store');
    }
    return this._userModel.updateOne(
      { _id: authUser._id },
      {
        $push: { stores: store._id },
        $set: { type: UserTypeEnum.VENDOR },
      },
    );
  }

  async attachPaymentMethod(method: PaymentMethodModel, authUser: UserModel) {
    return this._userModel.updateOne(
      { _id: authUser._id },
      {
        $push: { paymentMethods: method._id },
      },
    );
  }

  async detachPaymentMethod(method: PaymentMethodModel, authUser: UserModel) {
    return this._userModel.updateOne(
      { _id: authUser._id },
      {
        $pullAll: { paymentMethods: method._id },
      },
    );
  }
}
