import { MediasService } from '@modules/medias/medias.service';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { RatingsService } from '@modules/ratings/ratings.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { CreateProductDto, CreateProductExtraDto } from './dto/products.dto';

@Injectable()
export class ProductsService {
  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(RatingsService)
  private readonly _ratingsService: RatingsService;

  getProductModel() {
    return this._productModel;
  }

  getProductCategoryModel() {
    return this._productCategoryModel;
  }

  async findOneById(id: string) {
    return this._productModel
      .findOne({ _id: id })
      .populate('category')
      .populate({
        path: 'ratings',
        populate: {
          path: 'user',
        },
      })
      .populate('likedBy')
      .populate('store')
      .exec();
  }

  async existsInStore(title: string, storeId: string) {
    return this._productModel
      .findOne({ title, store: { _id: storeId } })
      .exec();
  }

  async create(
    args: CreateProductDto,
    user: UserModel,
    store: StoreModel,
    image?: Express.Multer.File,
  ) {
    const category = await this._productCategoryModel
      .findOne({ _id: args.category })
      .exec();

    if (!category) {
      throw new NotFoundException('category_not_found');
    }

    let imageUrl: string;

    if (image) {
      try {
        const url = await this._mediasService.upload(
          image,
          user,
          `stores/${store.id}/products`,
        );
        imageUrl = url;
      } catch (e) {
        throw new BadRequestException('error_uploading_image');
      }
    }

    const originCountry = args.originCountry ?? store.address.country;

    const product = await this._productModel.create({
      ...args,
      category: category._id,
      store: store._id,
      currency: store.currency,
      ...(originCountry && {
        originCountry,
      }),
      discountPrice: 0,
      ...(imageUrl && { profileImage: imageUrl }),
    });

    return this.findOneById(product._id.toString());
  }

  async createExtra(
    args: CreateProductExtraDto,
    product: ProductModel,
    store: StoreModel,
    user: UserModel,
  ) {
    const exists = await this._productModel
      .findOne({
        _id: product._id,
        store: { _id: store._id },
        extras: {
          $elemMatch: { title: { $regex: new RegExp(`^${args.title}$`, 'i') } },
        },
      })
      .exec();

    if (exists) {
      throw new BadRequestException('product_extra_already_exists');
    }

    return await this._productModel
      .updateOne(
        { _id: product._id },
        {
          $push: {
            extras: {
              ...args,
            },
          },
        },
        {
          new: true,
          upsert: true,
        },
      )
      .exec();
  }

  async deleteExtra(id: string, title: string, user: UserModel) {
    const product = await this._productModel
      .findOne({
        _id: id,
        extras: {
          $elemMatch: { title: { $regex: new RegExp(`^${title}$`, 'i') } },
        },
      })
      .populate('store')
      .exec();

    if (!product) {
      throw new NotFoundException('product_extra_not_found');
    }

    if (product.store.owner.toString() !== user._id.toString()) {
      throw new ForbiddenException('not_allowed');
    }

    await this._productModel
      .updateOne(
        { _id: product._id },
        {
          $pull: {
            extras: {
              title: { $regex: new RegExp(`^${title}$`, 'i') },
            },
          },
        },
        {
          new: true,
          upsert: true,
        },
      )
      .exec();

    return this.findOneById(id);
  }

  async createRating(id: string, args: CreateRatingDto, user: UserModel) {
    const product = await this._productModel
      .findOne({ _id: id })
      // .populate('ratings')
      .exec();
    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    try {
      const rating = await this._ratingsService.createProductRating(
        args,
        product,
        user,
      );

      if (rating) {
        await this._productModel
          .updateOne(
            { _id: product._id },
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
      return this.findOneById(product._id.toString());
    } catch (e) {
      throw new BadRequestException('error_creating_rating');
    }
  }
}
