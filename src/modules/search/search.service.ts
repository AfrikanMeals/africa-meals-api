import { OffersService } from '@modules/offers/offers.service';
import { ProductsService } from '@modules/products/products.service';
import { StoreService } from '@modules/store/store.service';
import { Inject, Injectable } from '@nestjs/common';
import { OfferModel, OfferStatusEnum } from '@schemas/offer.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Types } from 'mongoose';
import { SearchContent, SearchDto, SearchResultDto } from './dto/search.dto';

@Injectable()
export class SearchService {
  /** Évite qu’un caractère spécial dans la requête casse le regex Mongo. */
  private _escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * `req.user` peut ne pas exposer le virtual `id` selon le contexte ; `_id` est fiable.
   * Sinon `new ObjectId(undefined)` lève et produit un 500 (ex. search avec Bearer, sans user en navigateur).
   */
  private _userObjectId(user?: UserModel): Types.ObjectId | null {
    if (!user) return null;
    const u = user as unknown as { _id?: Types.ObjectId | string; id?: string };
    const raw = u._id ?? u.id;
    if (raw == null || raw === '') return null;
    try {
      if (raw instanceof Types.ObjectId) return raw;
      const s = String(raw);
      if (!Types.ObjectId.isValid(s)) return null;
      return new Types.ObjectId(s);
    } catch {
      return null;
    }
  }

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(StoreService)
  private readonly _storeService: StoreService;

  @Inject(OffersService)
  private readonly _offersService: OffersService;

  async filter(args: SearchDto, user?: UserModel) {
    args.page = args.page ?? 1;
    args.take = args.take ?? 5;
    const searchContent = args.searchContent;
    // console.log('🚀 ~ SearchService ~ filter ~ args:', searchContent);
    const response: {
      [key: string]:
        | SearchResultDto<ProductModel>
        | SearchResultDto<StoreModel>
        | SearchResultDto<OfferModel>;
    } = {};

    if (searchContent.includes(SearchContent.PRODUCTS)) {
      response.products = await this._filterProducts(args, user);
    }

    if (searchContent.includes(SearchContent.STORES)) {
      response.stores = await this._filterStores(args, user);
    }

    if (searchContent.includes(SearchContent.OFFERS)) {
      response.offers = await this._filterOffers(args, user);
    }

    return response;
  }

  private async _filterOffers(args: SearchDto, user?: UserModel) {
    const ownerOid = this._userObjectId(user);
    const pipeline = [
      {
        $match: {
          $and: [
            {
              $or: [
                ownerOid ? { owner: ownerOid } : null,
                { status: OfferStatusEnum.ACTIVE },
              ].filter(Boolean),
            },
            args.storeId && {
              _id: new Types.ObjectId(args.storeId),
            },
            {
              $or: [
                { title: { $regex: args.query ?? '', $options: 'i' } },
                { bio: { $regex: args.query ?? '', $options: 'i' } },
                { about: { $regex: args.query ?? '', $options: 'i' } },
              ],
            },
          ].filter(Boolean),
        },
      },
      {
        $project: {
          _id: 1,
        },
      },
    ];

    const [count, offerIds] = await Promise.all([
      this._offersService.getModel().countDocuments(pipeline[0].$match).exec(),
      // this._productsService.getProductModel().aggregate(pipeline).project({
      //   _id: 1,
      // }),
      // .populate('store'),

      this._offersService
        .getModel()
        .aggregate(pipeline)
        .project({
          _id: 1,
        })
        .skip((args.page - 1) * args.take)
        .limit(args.take)
        .exec(),
    ]);

    if (!offerIds.length) {
      return {
        items: [],
        total: 0,
        page: args.page,
        limit: args.take,
      };
    }

    return {
      items: await Promise.all(
        (offerIds ?? []).map((offerId) =>
          this._offersService.findOne(offerId, user),
        ),
      ),
      total: count,
      page: args.page,
      limit: args.take,
    };
  }

  private async _filterProducts(
    args: SearchDto,
    user?: UserModel,
  ): Promise<SearchResultDto<ProductModel>> {
    const ownerOid = this._userObjectId(user);
    const pipeline = [
      {
        $lookup: {
          from: 'stores',
          localField: 'store',
          foreignField: '_id',
          as: 'store',
        },
      },
      {
        $addFields: {
          store: {
            $arrayElemAt: ['$store', 0],
          },
        },
      },
      {
        $match: {
          $and: [
            {
              $or: [
                ownerOid ? { 'store.owner': ownerOid } : null,
                { status: ProductStatusEnum.ACTIVE },
              ].filter(Boolean),
            },
            {
              'store.acceptsOrders': true,
            },
            // {
            //   status: ProductStatusEnum.ACTIVE,
            // },
            args.categoryId && {
              category: { $eq: new Types.ObjectId(args.categoryId) },
            },
            {
              $or: [
                { title: { $regex: args.query ?? '', $options: 'i' } },
                { bio: { $regex: args.query ?? '', $options: 'i' } },
                { about: { $regex: args.query ?? '', $options: 'i' } },
              ],
            },
            args.storeId && {
              store: { $eq: new Types.ObjectId(args.storeId) },
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
      // this._productsService
      //   .getProductModel()
      //   .countDocuments(pipeline[0].$match),
      this._productsService.getProductModel().aggregate(pipeline).project({
        _id: 1,
      }),
      // .populate('store'),

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
      .find({ _id: { $in: productsIds.map((p) => new Types.ObjectId(p._id)) } })
      .populate('category')

      .populate({
        path: 'ratings',
        populate: {
          path: 'user',
        },
      })
      .populate('likedBy')
      .populate({
        path: 'store',
        populate: {
          path: 'address',
          select: 'label address city country location',
        },
      })
      .sort({ [args.sortBy ?? 'createdAt']: args.sortDirection ?? 'desc' })
      .exec();

    return {
      items: products ?? [],
      total: count.length,
      page: args.page,
      limit: args.take,
    };
  }

  private async _filterStores(
    args: SearchDto,
    user?: UserModel,
  ): Promise<SearchResultDto<StoreModel>> {
    const ownerOid = this._userObjectId(user);
    const q = args.query?.trim();
    const andParts: Record<string, unknown>[] = [
      {
        $or: [
          ownerOid ? { owner: ownerOid } : null,
          {
            status: {
              $in: [
                StoreStatusEnum.ACTIVE,
                StoreStatusEnum.PENDING,
                StoreStatusEnum.REVISION,
              ],
            },
          },
        ].filter(Boolean),
      },
    ];
    if (q) {
      const esc = this._escapeRegex(q);
      andParts.push({
        $or: [
          { name: { $regex: esc, $options: 'i' } },
          { bio: { $regex: esc, $options: 'i' } },
        ],
      });
    }
    const pipeline = [
      {
        $match: {
          $and: andParts,
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
