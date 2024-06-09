import { AddressesService } from '@modules/addresses/addresses.service';
import { MediasService } from '@modules/medias/medias.service';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { CreateStoreDto } from './dto/store.dto';

@Injectable()
export class StoreService {
  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @Inject(AddressesService)
  private readonly _addressesService: AddressesService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  async findOneById(id: string) {
    return this._storeModel
      .findOne({ _id: id })
      .populate('address')
      .populate('owner')
      .populate('ratings')
      .populate('likedBy')
      .exec();
  }

  async create({ address, ...args }: CreateStoreDto, user: UserModel) {
    const exists = await this._storeModel.findOne({ name: args.name }).exec();

    if (exists) {
      throw new ConflictException('store_already_exists');
    }

    const addr = await this._addressesService.create(address, user);

    if (!addr) {
      throw new ConflictException('address_not_found');
    }

    const store = await this._storeModel.create({
      ...args,
      address: addr._id,
      owner: user._id,
    });

    return this.findOneById(store._id.toString());
  }

  async updateProfileImage(
    id: string,
    file: Express.Multer.File,
    user: UserModel,
  ) {
    try {
      const store = await this._storeModel
        .findOne({ _id: id, owner: user._id })
        .exec();

      if (!store) {
        throw new BadRequestException('store_not_found');
      }

      const url = await this._mediasService.upload(
        file,
        user,
        `stores/${id}/profile`,
      );
      if (!url) {
        throw new BadRequestException('image_upload_failed');
      }

      await this._storeModel
        .updateOne({ _id: id }, { profileImage: url })
        .exec();
      return { url };
    } catch (e) {
      console.log('🚀 ~ StoreService ~ updateProfileImage ~ e:', e);
      throw e;
    }
  }
}
