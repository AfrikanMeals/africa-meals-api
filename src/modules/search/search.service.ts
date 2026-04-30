import { OffersService } from '@modules/offers/offers.service';
import { ProductsService } from '@modules/products/products.service';
import { StoreService } from '@modules/store/store.service';
import { Inject, Injectable } from '@nestjs/common';
import { OfferModel, OfferStatusEnum } from '@schemas/offer.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { PipelineStage, Types } from 'mongoose';
import {
  SearchContent,
  SearchDto,
  SearchResultDto,
  SortBy,
  SortOrder,
} from './dto/search.dto';

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

  /**
   * Tri agrégation / find produits : noms Mongo réels (évite les virtuals non stockés).
   */
  private _productSortKeys(args: SearchDto): Record<string, 1 | -1> {
    const dir = args.sortDirection === SortOrder.ASC ? 1 : -1;
    switch (args.sortBy) {
      case SortBy.PRICE:
        return { price: dir };
      case SortBy.NAME:
        return { title: dir };
      case SortBy.RATING:
        // `averageRating` n’est pas un champ stocké — tri stable par fraîcheur
        return { updatedAt: dir };
      case SortBy.CREATED_AT:
      default:
        return { createdAt: dir };
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
    const sortKeys = this._productSortKeys(args);
    const facetPipeline: PipelineStage[] = [
      ...pipeline,
      {
        $facet: {
          rows: [
            { $sort: sortKeys },
            { $skip: (args.page! - 1) * args.take! },
            { $limit: args.take! },
            { $project: { _id: 1 } },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];

    const facetAgg = await this._productsService
      .getProductModel()
      .aggregate(facetPipeline)
      .exec();

    const facet = facetAgg[0] as
      | {
          rows: { _id: Types.ObjectId }[];
          total: { n: number }[];
        }
      | undefined;
    const productsIds = facet?.rows ?? [];
    const total = facet?.total?.[0]?.n ?? 0;

    if (!productsIds.length) {
      return {
        items: [],
        total,
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
      .sort(sortKeys)
      .exec();

    return {
      items: products ?? [],
      total,
      page: args.page,
      limit: args.take,
    };
  }

  /**
   * Produits pour l’accueil boutique : une seule agrégation, champs minimaux (pas de populate lourd).
   * Même filtre métier que la recherche produits « vides » + tri récent.
   */
  async homeFeedProducts(
    user?: UserModel,
    limit = 48,
  ): Promise<Record<string, unknown>[]> {
    const ownerOid = this._userObjectId(user);
    const safeLimit = Math.min(120, Math.max(1, Math.floor(limit)));
    const pipeline: PipelineStage[] = [
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
          store: { $arrayElemAt: ['$store', 0] },
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
            { 'store.acceptsOrders': true },
            {
              $or: [
                { title: { $regex: '', $options: 'i' } },
                { bio: { $regex: '', $options: 'i' } },
                { about: { $regex: '', $options: 'i' } },
              ],
            },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: safeLimit },
      {
        $lookup: {
          from: 'product_categories',
          localField: 'category',
          foreignField: '_id',
          as: '_cat',
        },
      },
      {
        $lookup: {
          from: 'product_ratings',
          let: { pid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$product', '$$pid'] } } },
            { $project: { _id: 0, rate: 1 } },
          ],
          as: '_rates',
        },
      },
      {
        $addFields: {
          likesCount: { $size: { $ifNull: ['$likedBy', []] } },
          averageRating: {
            $let: {
              vars: {
                sz: { $size: { $ifNull: ['$_rates', []] } },
                sumRates: {
                  $sum: {
                    $map: {
                      input: '$_rates',
                      as: 'r',
                      in: '$$r.rate',
                    },
                  },
                },
              },
              in: {
                $cond: [
                  { $gt: ['$$sz', 0] },
                  { $divide: ['$$sumRates', '$$sz'] },
                  0,
                ],
              },
            },
          },
          _category: { $arrayElemAt: ['$_cat', 0] },
        },
      },
      {
        $project: {
          _id: 1,
          title: 1,
          bio: 1,
          originCountry: { $ifNull: ['$originCountry', ''] },
          price: 1,
          discountPrice: { $ifNull: ['$discountPrice', 0] },
          currency: { $ifNull: ['$currency', 'CAD'] },
          profileImage: { $ifNull: ['$profileImage', ''] },
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          likesCount: 1,
          averageRating: { $ifNull: ['$averageRating', 0] },
          category: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$_cat', []] } }, 0] },
              {
                id: { $toString: '$_category._id' },
                _id: '$_category._id',
                title: '$_category.title',
                icon: '$_category.icon',
                isEnabled: { $ifNull: ['$_category.is_enabled', true] },
                createdAt: '$_category.createdAt',
                updatedAt: '$_category.updatedAt',
              },
              null,
            ],
          },
          store: {
            id: { $toString: '$store._id' },
            _id: '$store._id',
            name: '$store.name',
            status: { $toString: '$store.status' },
            bio: { $ifNull: ['$store.bio', ''] },
            acceptsOrders: { $ifNull: ['$store.acceptsOrders', true] },
            supportsShipping: { $ifNull: ['$store.supportsShipping', false] },
            currency: { $ifNull: ['$store.currency', 'CAD'] },
            email: { $ifNull: ['$store.email', ''] },
            phoneNumber: { $ifNull: ['$store.phoneNumber', ''] },
            profileImage: { $ifNull: ['$store.profileImage', ''] },
            owner: { $ifNull: ['$store.owner', null] },
            createdAt: '$store.createdAt',
            updatedAt: '$store.updatedAt',
            canCreateProducts: { $ifNull: ['$store.canCreateProducts', false] },
            shippingZones: { $ifNull: ['$store.shippingZones', []] },
            averageRating: { $ifNull: ['$store.averageRating', 0] },
          },
        },
      },
    ];

    const raw = await this._productsService
      .getProductModel()
      .aggregate(pipeline)
      .exec();

    return (raw as Record<string, unknown>[]).map((doc) => {
      const likes = Number(doc.likesCount ?? 0);
      const cat = doc.category as Record<string, unknown> | null;
      const st = doc.store as Record<string, unknown> | null;
      const owner = st?.['owner'];
      const ownerStr =
        owner != null && typeof owner === 'object' && 'toString' in owner
          ? (owner as Types.ObjectId).toString()
          : owner != null
            ? String(owner)
            : '';
      return {
        ...doc,
        id: String(doc._id),
        likedBy: likes > 0 ? Array.from({ length: likes }, () => '') : [],
        ratings: [],
        extras: [],
        galleryImages: [],
        ordersCount: 0,
        inCart: false,
        category:
          cat && cat['title'] != null
            ? {
                ...cat,
                isEnabled: cat['isEnabled'] !== false,
              }
            : {
                id: '',
                title: '',
                icon: '',
                isEnabled: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
        store: st && st['name'] != null
            ? {
                ...st,
                owner: ownerStr,
              }
            : {
                id: '',
                name: '',
                status: 'INACTIVE',
                bio: '',
                acceptsOrders: false,
                supportsShipping: false,
                currency: 'CAD',
                email: '',
                phoneNumber: '',
                profileImage: '',
                owner: '',
                likedBy: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                canCreateProducts: false,
                shippingZones: [],
                averageRating: 0.0,
              },
      };
    });
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
