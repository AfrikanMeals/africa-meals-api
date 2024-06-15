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

    // TODO users have only one address for now
    if (user.addresses?.length) {
      throw new ConflictException('user_has_addresses');
    }

    const address = await this._addressesService.create(
      { ...args, isDefault: true },
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
}
