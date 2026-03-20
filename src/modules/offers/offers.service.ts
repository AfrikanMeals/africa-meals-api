import { ProductsService } from '@modules/products/products.service';
import { SearchResultDto } from '@modules/search/dto/search.dto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  OfferItemModel,
  OfferItemTypeEnum,
  OfferModel,
  OfferStatusEnum,
} from '@schemas/offer.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import dayjs from 'dayjs';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { CreateOfferDto, FilterOffersDto } from './dto/offers.dto';

@Injectable()
export class OffersService {
  @InjectModel(OfferModel.name)
  private readonly _offerModel: Model<OfferModel>;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  getModel() {
    return this._offerModel;
  }

  async filter(
    args: FilterOffersDto,
    user: UserModel,
  ): Promise<SearchResultDto<OfferModel>> {
    const take = +(args.take || 10);
    const page = +(args.page || 1);

    const pipeline = [
      // {
      //   $lookup: {
      //     from: 'stores',
      //     localField: 'store',
      //     foreignField: '_id',
      //     as: 'store',
      //   },
      // },
      // {
      //   $addFields: {
      //     store: {
      //       $arrayElemAt: ['$store', 0],
      //     },
      //   },
      // },
      {
        $match: {
          $and: [
            args.storeId ? { store: new ObjectId(args.storeId) } : null,
            args.status ? { status: args.status } : null,
          ].filter(Boolean),
        },
      },
    ];
    // console.log(
    //   '🚀 ~ OffersService ~ pipeline:',
    //   JSON.stringify(pipeline, null, 2),
    // );

    const [count, offers] = await Promise.all([
      this._offerModel.countDocuments(pipeline[0].$match).exec(),
      this._offerModel
        .aggregate(pipeline)
        .project({
          _id: 1,
        })
        .skip((page - 1) * take)
        .limit(take)
        .exec(),
    ]);

    if (!offers?.length) {
      return {
        items: [],
        total: 0,
        page,
        limit: take,
      };
    }

    const items = await Promise.all(
      offers.map((offer) => this.findOne(offer._id.toString(), user, true)),
    );

    return {
      items,
      total: count,
      page,
      limit: take,
    };
  }

  async findOne(
    id: string,
    user: UserModel,
    skipValidityCheck = false,
  ): Promise<any> {
    const offer = await this._offerModel
      .findOne({ _id: id })
      .populate({
        path: 'store',
        populate: [
          {
            path: 'owner',
          },
          {
            path: 'address',
          },
        ],
      })
      // .select('+items')
      .exec();

    if (!offer) {
      throw new NotFoundException('offer_not_found');
    }

    if (
      !skipValidityCheck &&
      offer.status !== OfferStatusEnum.ACTIVE &&
      offer.store.owner.id !== user.id
    ) {
      throw new ForbiddenException('offer_not_active');
    }

    const obj = offer.toJSON();
    // console.log(
    //   '🚀 ~ OffersService ~ findOne ~ obj:',
    //   JSON.stringify(obj, null, 2),
    // );

    return {
      ...obj,
      items: await Promise.all(
        (obj.items || []).map(async (item) => {
          if (item.type === OfferItemTypeEnum.PRODUCT) {
            const product = await this._productsService.findOneById(
              item.entityId,
            );
            item.entity = product;
          } else {
            const product = await this._productsService.findOneById(
              item.productId,
            );
            const extra = product.extras.find(
              (extra) => extra._id.toString() === item.entityId,
            );
            if (extra) {
              item.entity = extra;
            }
          }
          delete item.productId;
          delete item.entityId;
          return item;
        }),
      ),
    };
  }

  async create(
    args: CreateOfferDto,
    store: StoreModel,
    user: UserModel,
  ): Promise<any> {
    const existingOffer = await this._offerModel
      .findOne({
        store: {
          _id: store.id,
          owner: { _id: user.id },
        },
        title: { $regex: args.title, $options: 'i' },
      })
      .exec();

    if (existingOffer) {
      throw new ConflictException('offer_already_exists');
    }

    const items: Partial<OfferItemModel>[] = [];

    for (const item of args.items) {
      const { type, price, entityId, productId, quantity } = item;
      // const [id, extraId] = item.split('||');
      // if (!id) {
      //   throw new BadRequestException('invalid_items');
      // }

      let product: ProductModel;
      if (type === OfferItemTypeEnum.PRODUCT) {
        product = await this._productsService.findOneById(entityId);
        if (!product) {
          throw new NotFoundException('product_not_found');
        }

        if (product.store.id !== store.id) {
          throw new ForbiddenException('product_not_in_store');
        }

        items.push({
          type,
          price,
          entityId: product.id,
          quantity,
        });
      } else {
        product = await this._productsService.findOneById(productId);
        if (!product) {
          throw new NotFoundException('product_not_found');
        }

        if (product.store.id !== store.id) {
          throw new ForbiddenException('product_not_in_store');
        }

        const extraExists = (product.extras || []).find(
          (extra) => extra._id.toString() === entityId,
        );
        if (!extraExists) {
          throw new NotFoundException('product_extra_not_found');
        }

        items.push({
          type,
          price,
          productId: product.id,
          entityId,
          quantity,
        });
      }
    }

    const offer = await this._offerModel.create({
      ...args,
      price: (items || [])
        .map((item) => item.price)
        .reduce((a, b) => a + b, 0)
        .toFixed(2),
      discountPrice: args.price,
      startDate: args.startDate ? dayjs(args.startDate).toDate() : null,
      endDate: args.endDate ? dayjs(args.endDate).toDate() : null,
      store: store.id,
      items,
    });

    return await this.findOne(offer._id.toString(), user);
  }

  async isProductUsedInOffer(id: string, user: UserModel) {
    const offer = await this._offerModel
      .findOne({
        items: {
          $elemMatch: {
            type: OfferItemTypeEnum.PRODUCT,
            productId: id,
          },
        },
      })
      .exec();
    return !!offer;
  }

  async isProductExtraUsedInOffer(
    id: string,
    extraKey: string,
    user: UserModel,
  ) {
    const offer = await this._offerModel
      .findOne({
        items: {
          $elemMatch: {
            type: OfferItemTypeEnum.PRODUCT_EXTRA,
            entityId: extraKey,
            productId: id,
          },
        },
        // items: {
        //   type: OfferItemTypeEnum.PRODUCT_EXTRA,
        //   entityId: extraKey,
        //   productId: id,
        //   // $elemMatch: {
        //   //   $regex: new RegExp(`^${id}||${extraKey}$`, 'i'),
        //   // },
        // },
      })
      .exec();
    return !!offer;
  }
}
