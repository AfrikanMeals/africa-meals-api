import { AddressesService } from '@modules/addresses/addresses.service';
import { MediasService } from '@modules/medias/medias.service';
import {
  CreateProductDto,
  CreateProductExtraDto,
} from '@modules/products/dto/products.dto';
import { ProductsService } from '@modules/products/products.service';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { RatingsService } from '@modules/ratings/ratings.service';
import { UsersService } from '@modules/users/users.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
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

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(UsersService)
  private readonly _usersService: UsersService;

  @Inject(RatingsService)
  private readonly _ratingsService: RatingsService;

  getStoreModel() {
    return this._storeModel;
  }

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

    const hasStore = await this._usersService.hasStore(user);

    if (hasStore) {
      throw new ConflictException('user_has_store');
    }

    const store = await this._storeModel.create({
      ...args,
      address: addr._id,
      owner: user._id,
    });

    if (!store) {
      throw new BadRequestException('could_not_create_store');
    }

    await this._usersService.addStore(store, user);

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

  async createProduct(
    id: string,
    args: CreateProductDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    const store = await this._storeModel
      .findOne({ _id: id, owner: user._id })
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    const exists = await this._productsService.existsInStore(
      args.title,
      store._id.toString(),
    );

    if (exists) {
      throw new ConflictException('product_already_exists');
    }

    const product = await this._productsService.create(
      args,
      user,
      store,
      image,
    );
    return this._productsService.findOneById(product._id.toString());
  }

  async createProducExtra(
    productId: string,
    storeId: string,
    args: CreateProductExtraDto,
    user: UserModel,
  ) {
    const store = await this._storeModel
      .findOne({ _id: storeId, owner: user._id })
      .exec();

    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    if (!store.canCreateProducts) {
      throw new ForbiddenException('can_not_create_products');
    }

    const product = await this._productsService.findOneById(productId);

    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    try {
      const extra = await this._productsService.createExtra(
        args,
        product,
        store,
        user,
      );

      return this._productsService.findOneById(productId);
    } catch (e) {
      console.log('🚀 ~ StoreService ~ e:', e instanceof BadRequestException);
      throw e;
    }
  }

  async createRating(id: string, args: CreateRatingDto, user: UserModel) {
    const store = await this._storeModel
      .findOne({ _id: id })
      // .populate('ratings')
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }

    try {
      const rating = await this._ratingsService.createStoreRating(
        args,
        store,
        user,
      );

      if (rating) {
        await this._storeModel
          .updateOne(
            { _id: store._id },
            {
              $push: {
                ratings: rating._id,
              },
            },
            {
              new: true,
              upsert: true,
            },
          )
          .exec();
      }
      return this.findOneById(store._id.toString());
    } catch (e) {
      console.log('🚀 ~ StoreService ~ createRating ~ e:', e);
      throw new BadRequestException('error_creating_rating');
    }
  }
}
