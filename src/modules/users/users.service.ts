import { AddressesService } from '@modules/addresses/addresses.service';
import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AddressTypeEnum } from '@schemas/address.schema';
import { PaymentMethodModel } from '@schemas/payment-method.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';

@Injectable()
export class UsersService {
  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

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
