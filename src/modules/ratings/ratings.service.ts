import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductModel } from '@schemas/product.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import { StoreModel } from '@schemas/store.schema';
import { StoreRatingModel } from '@schemas/store_rating.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { CreateRatingDto } from './dto/ratings.dto';

@Injectable()
export class RatingsService {
  @InjectModel(ProductRatingModel.name)
  private readonly _productRatingModel: Model<ProductRatingModel>;
  @InjectModel(StoreRatingModel.name)
  private readonly _storeRatingModel: Model<StoreRatingModel>;

  async hasRatedProduct(product: ProductModel, user: UserModel) {
    return (
      (await this._productRatingModel
        .countDocuments({ product: product.id, user: user.id })
        .exec()) > 0
    );
  }

  async hasRatedStore(store: StoreModel, user: UserModel) {
    return (
      (await this._storeRatingModel
        .countDocuments({ store: store.id, user: user.id })
        .exec()) > 0
    );
  }

  async createProductRating(
    args: CreateRatingDto,
    product: ProductModel,
    user: UserModel,
  ) {
    const exists = await this.hasRatedProduct(product, user);
    if (exists) {
      throw new ConflictException('already_rated');
    }

    return this._productRatingModel.create({
      ...args,
      product: product.id,
      user: user.id,
    });
  }

  async createStoreRating(
    args: CreateRatingDto,
    store: StoreModel,
    user: UserModel,
  ) {
    const exists = await this.hasRatedStore(store, user);
    if (exists) {
      throw new ConflictException('already_rated');
    }

    return this._storeRatingModel.create({
      ...args,
      store: store.id,
      user: user.id,
    });
  }
}
