import { MediasService } from '@modules/medias/medias.service';
import {
  BadRequestException,
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

  async findOneById(id: string) {
    return this._productModel
      .findOne({ _id: id })
      .populate('category')
      .populate('ratings')
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

    const product = await this._productModel.create({
      ...args,
      category: category._id,
      store: store._id,
      currency: store.currency,
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
        extras: { $elemMatch: { title: args.title } },
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
}
