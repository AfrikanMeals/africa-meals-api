import { ProductsService } from '@modules/products/products.service';
import { StoreService } from '@modules/store/store.service';
import { Inject, Injectable } from '@nestjs/common';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { ObjectId } from 'mongodb';
import { SearchContent, SearchDto, SearchResultDto } from './dto/search.dto';

@Injectable()
export class SearchService {
  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(StoreService)
  private readonly _storeService: StoreService;

  async filter(args: SearchDto, user?: UserModel) {
    args.page = args.page ?? 1;
    args.take = args.take ?? 5;
    const searchContent = (args.searchContent as any as string).split(
      ',',
    ) as SearchContent[];
    // console.log('🚀 ~ SearchService ~ filter ~ args:', searchContent);
    const response: {
      [key: string]:
        | SearchResultDto<ProductModel>
        | SearchResultDto<StoreModel>;
    } = {};

    if (searchContent.includes(SearchContent.PRODUCTS)) {
      response.products = await this._filterProducts(args, user);
    }

    if (searchContent.includes(SearchContent.STORES)) {
      response.stores = await this._filterStores(args, user);
    }

    return response;
  }

  private async _filterProducts(
    args: SearchDto,
    user?: UserModel,
  ): Promise<SearchResultDto<ProductModel>> {
    const pipeline = [
      {
        $match: {
          $and: [
            // {
            //   $or: [
            //     user ? { owner: { $eq: new ObjectId(user.id) } } : null,
            //     { status: ProductStatusEnum.ACTIVE },
            //   ].filter(Boolean),
            // },
            {
              status: ProductStatusEnum.ACTIVE,
            },
            args.categoryId && {
              category: { $eq: new ObjectId(args.categoryId) },
            },
            {
              $or: [
                { title: { $regex: args.query ?? '', $options: 'i' } },
                { bio: { $regex: args.query ?? '', $options: 'i' } },
                { about: { $regex: args.query ?? '', $options: 'i' } },
              ],
            },
            args.storeId && {
              store: { $eq: new ObjectId(args.storeId) },
            },
            args.minPrice &&
              args.minPrice !== undefined &&
              args.minPrice !== null && {
                price: { $gte: +args.minPrice },
              },
            args.maxPrice &&
              args.maxPrice !== undefined &&
              args.maxPrice !== null && {
                price: { $lte: +args.maxPrice },
              },
          ].filter(Boolean),
        },
      },
    ];
    // console.log('🚀 ~ SearchService ~ pipeline:', JSON.stringify(pipeline));

    const [count, productsIds] = await Promise.all([
      this._productsService
        .getProductModel()
        .countDocuments(pipeline[0].$match),

      this._productsService
        .getProductModel()
        .aggregate(pipeline)
        .project({
          _id: 1,
        })
        // .lookup({
        //   from: 'product_categories',
        //   localField: 'category',
        //   foreignField: '_id',
        //   as: 'categoryInfo',
        // })
        // .addFields({
        //   category: { $arrayElemAt: ['$categoryInfo', 0] },
        // })
        // .lookup({
        //   from: 'stores',
        //   localField: 'store',
        //   foreignField: '_id',
        //   as: 'storeInfo',
        // })
        // .addFields({
        //   store: { $arrayElemAt: ['$storeInfo', 0] },
        // })
        // .project({
        //   categoryInfo: 0, // Removing the categoryInfo array from the output
        //   storeInfo: 0,
        // })
        // .populate('category')
        //
        // .populate('likedBy')
        // .populate('store')
        // .sort({ [args.sortBy ?? 'createdAt']: args.sortDirection ?? 'desc' })
        .skip((args.page - 1) * args.take)
        .limit(args.take)
        .exec(),
    ]);
    // console.log(
    //   '🚀 ~ SearchService ~ productsIds:',
    //   JSON.stringify(productsIds),
    // );

    if (!productsIds.length) {
      return {
        items: [],
        total: 0,
        page: args.page,
        limit: args.take,
      };
    }

    const products = await this._productsService
      .getProductModel()
      .find({ _id: { $in: productsIds.map((p) => new ObjectId(p._id)) } })
      .populate('category')

      .populate({
        path: 'ratings',
        populate: {
          path: 'user',
        },
      })
      .populate('likedBy')
      .populate('store')
      .sort({ [args.sortBy ?? 'createdAt']: args.sortDirection ?? 'desc' })
      .exec();

    return {
      items: products ?? [],
      total: count,
      page: args.page,
      limit: args.take,
    };
  }

  private async _filterStores(
    args: SearchDto,
    user?: UserModel,
  ): Promise<SearchResultDto<StoreModel>> {
    const pipeline = [
      {
        $match: {
          $and: [
            {
              $or: [
                // user ? { owner: { $eq: new ObjectId(user.id) } } : null,
                user ? { owner: new ObjectId(user.id) } : null,
                { status: StoreStatusEnum.ACTIVE },
              ].filter(Boolean),
            },
            args.query
              ? {
                  $or: [
                    { name: { $regex: args.query, $options: 'i' } },
                    { bio: { $regex: args.query, $options: 'i' } },
                  ],
                }
              : {}, // If query is empty, this will match everything
          ],
        },
      },
      // {
      //   $project: {
      //     _id: 1,
      //   },
      // },
    ];

    const [count, storesIds] = await Promise.all([
      this._storeService.getStoreModel().countDocuments(pipeline[0].$match),

      this._storeService
        .getStoreModel()
        .aggregate(pipeline)
        .project({
          _id: 1,
        })
        // .sort({ [args.sortBy ?? 'createdAt']: args.sortDirection ?? 'desc' })
        .skip((args.page - 1) * args.take)
        .limit(args.take)
        .exec(),
    ]);

    if (!storesIds.length) {
      return {
        items: [],
        total: 0,
        page: args.page,
        limit: args.take,
      };
    }

    const stores = await this._storeService
      .getStoreModel()
      .find({ _id: { $in: storesIds.map((s) => s._id) } })
      .populate('address')
      .populate('owner')
      .populate({
        path: 'ratings',
        populate: {
          path: 'user',
        },
      })
      .populate('likedBy')
      .sort({ [args.sortBy ?? 'createdAt']: args.sortDirection ?? 'desc' })
      .exec();

    return {
      items: stores ?? [],
      total: count,
      page: args.page,
      limit: args.take,
    };
  }
}
