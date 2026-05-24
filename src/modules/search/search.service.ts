import {
  productEmbeddedStoreOwnerStripeOnboardedStages,
  storeOwnerStripeOnboardedPipelineStages,
} from '@modules/billing/stripe/stripe-connect-visibility';
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
import { mapInChunks } from '@utils/map-in-chunks';
import { productDailyMenuListingPipelineStages } from '@utils/product-daily-menu-listing.pipeline';
import { storeArticlesAvailabilityPipelineStages } from '@utils/store-articles-availability.pipeline';

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
   * Après `$lookup` store sur un produit : boutique ACTIVE + vendeur Stripe Connect
   * opérationnel (peut recevoir des paiements). Toujours appliqué sur le catalogue client.
   */
  private _clientMarketplaceProductStoreStages(): PipelineStage[] {
    return [
      { $match: { 'store.status': StoreStatusEnum.ACTIVE } },
      ...productEmbeddedStoreOwnerStripeOnboardedStages(),
    ];
  }

  /**
   * Tri agrégation / find produits : noms Mongo réels (évite les virtuals non stockés).
   */
  private _hasSearchGeo(args: SearchDto): boolean {
    const la = args.latitude;
    const ln = args.longitude;
    return (
      la != null &&
      ln != null &&
      Number.isFinite(la) &&
      Number.isFinite(ln)
    );
  }

  /** Si lat/lng valides : maxDistance par défaut 30 km, tri distance asc si sortBy absent. */
  private _normalizeSearchGeoArgs(args: SearchDto): void {
    if (!this._hasSearchGeo(args)) return;
    if (args.maxDistanceKm == null) args.maxDistanceKm = 30;
    args.maxDistanceKm = Math.min(
      100,
      Math.max(1, Math.floor(args.maxDistanceKm)),
    );
    if (args.sortBy == null) {
      args.sortBy = SortBy.DISTANCE;
      args.sortDirection = SortOrder.ASC;
    }
  }

  /**
   * Distance Haversine (km) entre un point client (littéraux) et les coords boutique `$__storeLat` / `$__storeLng`.
   */
  private _haversineKmExpr(
    userLatDeg: number,
    userLonDeg: number,
  ): Record<string, unknown> {
    const R = 6371;
    return {
      $cond: [
        {
          $and: [
            { $ne: ['$__storeLat', null] },
            { $ne: ['$__storeLng', null] },
          ],
        },
        {
          $multiply: [
            R,
            2,
            {
              $asin: {
                $min: [
                  1,
                  {
                    $sqrt: {
                      $add: [
                        {
                          $pow: [
                            {
                              $sin: {
                                $divide: [
                                  {
                                    $subtract: [
                                      {
                                        $degreesToRadians: '$__storeLat',
                                      },
                                      { $degreesToRadians: userLatDeg },
                                    ],
                                  },
                                  2,
                                ],
                              },
                            },
                            2,
                          ],
                        },
                        {
                          $multiply: [
                            { $cos: { $degreesToRadians: userLatDeg } },
                            { $cos: { $degreesToRadians: '$__storeLat' } },
                            {
                              $pow: [
                                {
                                  $sin: {
                                    $divide: [
                                      {
                                        $subtract: [
                                          {
                                            $degreesToRadians: '$__storeLng',
                                          },
                                          { $degreesToRadians: userLonDeg },
                                        ],
                                      },
                                      2,
                                    ],
                                  },
                                },
                                2,
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
        null,
      ],
    };
  }

  /** Menu du jour uniquement, avec stock > 0 (ou illimité). */
  private _productDailyMenuListingStages(): PipelineStage[] {
    return productDailyMenuListingPipelineStages();
  }

  /** Filtre rayon + champ `distanceKm` (lookup adresse boutique). */
  private _productGeoDistanceStages(args: SearchDto): PipelineStage[] {
    if (!this._hasSearchGeo(args)) {
      return [{ $addFields: { distanceKm: null } }];
    }
    const uLat = args.latitude as number;
    const uLon = args.longitude as number;
    const maxKm = args.maxDistanceKm ?? 30;
    return [
      this._lookupAddressPipelineStage('$store.address', '_searchGeoAddr'),
      {
        $addFields: {
          _searchGeoResAddr: { $arrayElemAt: ['$_searchGeoAddr', 0] },
        },
      },
      {
        $addFields: {
          __storeLat: {
            $cond: [
              {
                $gte: [
                  {
                    $size: {
                      $ifNull: [
                        '$_searchGeoResAddr.location.coordinates',
                        [],
                      ],
                    },
                  },
                  2,
                ],
              },
              {
                $arrayElemAt: [
                  '$_searchGeoResAddr.location.coordinates',
                  1,
                ],
              },
              null,
            ],
          },
          __storeLng: {
            $cond: [
              {
                $gte: [
                  {
                    $size: {
                      $ifNull: [
                        '$_searchGeoResAddr.location.coordinates',
                        [],
                      ],
                    },
                  },
                  2,
                ],
              },
              {
                $arrayElemAt: [
                  '$_searchGeoResAddr.location.coordinates',
                  0,
                ],
              },
              null,
            ],
          },
        },
      },
      {
        $addFields: {
          distanceKm: this._haversineKmExpr(uLat, uLon),
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $ne: ['$distanceKm', null] },
              { $lte: ['$distanceKm', maxKm] },
            ],
          },
        },
      },
    ];
  }

  /** Avant facet boutiques : coords + distance + filtre rayon + tri menu du jour (nombre de plats du jour). */
  private _storeDistanceAndMenuStages(args: SearchDto): PipelineStage[] {
    const dow = new Date().getDay();
    const stages: PipelineStage[] = [
      this._lookupAddressPipelineStage('$address', '_stGeoAddr'),
      {
        $addFields: {
          _stGeoRes: { $arrayElemAt: ['$_stGeoAddr', 0] },
        },
      },
      {
        $addFields: {
          __storeLat: {
            $cond: [
              {
                $gte: [
                  {
                    $size: {
                      $ifNull: ['$_stGeoRes.location.coordinates', []],
                    },
                  },
                  2,
                ],
              },
              { $arrayElemAt: ['$_stGeoRes.location.coordinates', 1] },
              null,
            ],
          },
          __storeLng: {
            $cond: [
              {
                $gte: [
                  {
                    $size: {
                      $ifNull: ['$_stGeoRes.location.coordinates', []],
                    },
                  },
                  2,
                ],
              },
              { $arrayElemAt: ['$_stGeoRes.location.coordinates', 0] },
              null,
            ],
          },
          __todayMenuCount: {
            $size: {
              $let: {
                vars: {
                  slot: {
                    $first: {
                      $filter: {
                        input: { $ifNull: ['$dailyMenuByWeekday', []] },
                        as: 's',
                        cond: { $eq: ['$$s.dayOfWeek', dow] },
                      },
                    },
                  },
                },
                in: { $ifNull: ['$$slot.items', []] },
              },
            },
          },
        },
      },
    ];

    if (this._hasSearchGeo(args)) {
      const uLat = args.latitude as number;
      const uLon = args.longitude as number;
      const maxKm = args.maxDistanceKm ?? 30;
      stages.push({
        $addFields: {
          distanceKm: this._haversineKmExpr(uLat, uLon),
        },
      });
      stages.push({
        $match: {
          $expr: {
            $and: [
              { $ne: ['$distanceKm', null] },
              { $lte: ['$distanceKm', maxKm] },
            ],
          },
        },
      });
    } else {
      stages.push({ $addFields: { distanceKm: null } });
    }

    return stages;
  }

  private _productSortKeys(args: SearchDto): Record<string, 1 | -1> {
    const dir = (args.sortDirection === SortOrder.ASC ? 1 : -1) as 1 | -1;
    switch (args.sortBy) {
      case SortBy.DISTANCE:
        if (this._hasSearchGeo(args)) {
          return {
            distanceKm: dir,
            __onDailyMenu: -1,
            createdAt: -1,
          };
        }
        return { createdAt: (-dir) as 1 | -1 };
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

  /** Tri liste boutiques (champs Mongo réels). */
  private _storeSortKeys(args: SearchDto): Record<string, 1 | -1> {
    const dir = (args.sortDirection === SortOrder.ASC ? 1 : -1) as 1 | -1;
    switch (args.sortBy) {
      case SortBy.DISTANCE:
        if (this._hasSearchGeo(args)) {
          return {
            distanceKm: dir,
            __todayMenuCount: -1,
            createdAt: -1,
          };
        }
        return { createdAt: (-dir) as 1 | -1 };
      case SortBy.NAME:
        return { name: dir };
      case SortBy.PRICE:
      case SortBy.RATING:
      case SortBy.CREATED_AT:
      default:
        return { createdAt: dir };
    }
  }

  /**
   * Jointure `addresses` : `localField` + `foreignField` échoue si la ref boutique est une
   * string (legacy) et `_id` adresse est un ObjectId — `$convert` unifie les deux cas.
   */
  private _lookupAddressPipelineStage(
    addressRefPath: string,
    as: string,
  ): PipelineStage {
    return {
      $lookup: {
        from: 'addresses',
        let: { addrRef: addressRefPath },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [
                  '$_id',
                  {
                    $convert: {
                      input: '$$addrRef',
                      to: 'objectId',
                      onError: null,
                      onNull: null,
                    },
                  },
                ],
              },
            },
          },
        ],
        as,
      },
    };
  }

  /**
   * Enrichissement « liste produit » : catégorie + note moyenne via `product_ratings`,
   * sans populate de toutes les notes (évite payloads ~300 Ko+ et scans lourds).
   */
  private _productLeanEnrichmentStages(): PipelineStage[] {
    return [
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
      this._lookupAddressPipelineStage('$store.address', '_storeAddr'),
      {
        $addFields: {
          _storeResolvedAddr: { $arrayElemAt: ['$_storeAddr', 0] },
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
                _id: { $toString: '$_category._id' },
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
            _id: { $toString: '$store._id' },
            name: '$store.name',
            status: { $toString: '$store.status' },
            bio: { $ifNull: ['$store.bio', ''] },
            email: { $ifNull: ['$store.email', ''] },
            phoneNumber: { $ifNull: ['$store.phoneNumber', ''] },
            acceptsOrders: { $ifNull: ['$store.acceptsOrders', true] },
            supportsShipping: { $ifNull: ['$store.supportsShipping', false] },
            currency: { $ifNull: ['$store.currency', 'CAD'] },
            profileImage: { $ifNull: ['$store.profileImage', ''] },
            likedBy: { $ifNull: ['$store.likedBy', []] },
            owner: {
              $convert: {
                input: '$store.owner',
                to: 'string',
                onError: '',
                onNull: '',
              },
            },
            createdAt: '$store.createdAt',
            updatedAt: '$store.updatedAt',
            canCreateProducts: { $ifNull: ['$store.canCreateProducts', false] },
            averageRating: { $ifNull: ['$store.averageRating', 0] },
            address: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$_storeAddr', []] } }, 0] },
                {
                  _id: { $toString: '$_storeResolvedAddr._id' },
                  isDefault: {
                    $ifNull: [
                      '$_storeResolvedAddr.is_default',
                      {
                        $ifNull: ['$_storeResolvedAddr.isDefault', false],
                      },
                    ],
                  },
                  label: { $ifNull: ['$_storeResolvedAddr.label', ''] },
                  address: { $ifNull: ['$_storeResolvedAddr.address', ''] },
                  country: { $ifNull: ['$_storeResolvedAddr.country', ''] },
                  city: { $ifNull: ['$_storeResolvedAddr.city', ''] },
                  countryCode: {
                    $ifNull: [
                      '$_storeResolvedAddr.country_code',
                      {
                        $ifNull: ['$_storeResolvedAddr.countryCode', ''],
                      },
                    ],
                  },
                  zipCode: {
                    $ifNull: [
                      '$_storeResolvedAddr.zip_code',
                      {
                        $ifNull: ['$_storeResolvedAddr.zipCode', ''],
                      },
                    ],
                  },
                  type: { $ifNull: ['$_storeResolvedAddr.type', 'USER'] },
                  location: {
                    $ifNull: ['$_storeResolvedAddr.location', null],
                  },
                  createdAt: '$_storeResolvedAddr.createdAt',
                  updatedAt: '$_storeResolvedAddr.updatedAt',
                },
                null,
              ],
            },
            latitude: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $size: { $ifNull: ['$_storeAddr', []] } }, 0] },
                    {
                      $gte: [
                        {
                          $size: {
                            $ifNull: [
                              '$_storeResolvedAddr.location.coordinates',
                              [],
                            ],
                          },
                        },
                        2,
                      ],
                    },
                  ],
                },
                {
                  $arrayElemAt: [
                    '$_storeResolvedAddr.location.coordinates',
                    1,
                  ],
                },
                null,
              ],
            },
            longitude: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $size: { $ifNull: ['$_storeAddr', []] } }, 0] },
                    {
                      $gte: [
                        {
                          $size: {
                            $ifNull: [
                              '$_storeResolvedAddr.location.coordinates',
                              [],
                            ],
                          },
                        },
                        2,
                      ],
                    },
                  ],
                },
                {
                  $arrayElemAt: [
                    '$_storeResolvedAddr.location.coordinates',
                    0,
                  ],
                },
                null,
              ],
            },
            dailyMenuByWeekday: {
              $ifNull: ['$store.dailyMenuByWeekday', []],
            },
          },
          distanceKm: { $ifNull: ['$distanceKm', null] },
        },
      },
    ];
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
    this._normalizeSearchGeoArgs(args);
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
      items: await mapInChunks(offerIds ?? [], 4, (row) =>
        this._offersService.findOne(row._id.toString(), user),
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
              'store._id': { $eq: new Types.ObjectId(args.storeId) },
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
      ...this._clientMarketplaceProductStoreStages(),
      ...this._productDailyMenuListingStages(),
      ...this._productGeoDistanceStages(args),
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
            ...this._productLeanEnrichmentStages(),
          ] as any[],
          total: [{ $count: 'n' }],
        },
      },
    ];

    const facetAgg = await this._productsService
      .getProductModel()
      .aggregate(facetPipeline)
      .option({ allowDiskUse: true })
      .exec();

    const facet = facetAgg[0] as
      | {
          rows: { _id: Types.ObjectId }[];
          total: { n: number }[];
        }
      | undefined;
    const leanRows = (facet?.rows ?? []) as Record<string, unknown>[];
    const total = facet?.total?.[0]?.n ?? 0;

    if (!leanRows.length) {
      return {
        items: [],
        total,
        page: args.page,
        limit: args.take,
      };
    }

    const items = leanRows.map((doc) => this._mapHomeFeedLeanDoc(doc));

    return {
      items: items as unknown as ProductModel[],
      total,
      page: args.page,
      limit: args.take,
    };
  }

  /**
   * Aperçu menu du jour (jour courant serveur) pour le produit : le mobile borne les quantités panier.
   */
  private _dailyMenuProductIdStr(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      return (value as { toString(): string }).toString();
    }
    return String(value).trim();
  }

  private _dailyMenuSlotItems(
    slot: Record<string, unknown> | undefined,
  ): Record<string, unknown>[] {
    if (!slot) return [];
    const rawItems = slot['items'];
    if (Array.isArray(rawItems) && rawItems.length) {
      return rawItems as Record<string, unknown>[];
    }
    const pids = slot['productIds'];
    if (!Array.isArray(pids)) return [];
    return pids.map((id) => ({
      productId: id,
      stockUnlimited: true,
      stockRemaining: 0,
    }));
  }

  private _buildDailyMenuTodayForProduct(
    storeRaw: Record<string, unknown> | null | undefined,
    productId: string,
  ): {
    onMenu: boolean;
    stockUnlimited: boolean;
    stockRemaining: number;
    soldOut: boolean;
  } {
    const dow = new Date().getDay();
    const rows = Array.isArray(storeRaw?.['dailyMenuByWeekday'])
      ? (storeRaw!['dailyMenuByWeekday'] as Record<string, unknown>[])
      : [];
    const slot = rows.find((r) => Number(r['dayOfWeek']) === dow);
    const items = this._dailyMenuSlotItems(slot);
    const pid = this._dailyMenuProductIdStr(productId);
    const it = items.find(
      (x) => this._dailyMenuProductIdStr(x['productId']) === pid,
    );
    if (!it) {
      return {
        onMenu: false,
        stockUnlimited: true,
        stockRemaining: 0,
        soldOut: false,
      };
    }
    const stockUnlimited = it['stockUnlimited'] !== false;
    const stockRemaining = stockUnlimited
      ? 0
      : Math.max(0, Math.floor(Number(it['stockRemaining'] ?? 0)));
    const soldOut = !stockUnlimited && stockRemaining <= 0;
    return {
      onMenu: true,
      stockUnlimited,
      stockRemaining,
      soldOut,
    };
  }

  /** Normalise une ligne d’agrégation « home feed » / menu boutique (JSON client, sans BSON). */
  private _mapHomeFeedLeanDoc(doc: Record<string, unknown>): Record<string, unknown> {
    const toIso = (v: unknown): string => {
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'string' || typeof v === 'number') return String(v);
      return new Date().toISOString();
    };
    const likes = Number(doc.likesCount ?? 0);
    const cat = doc.category as Record<string, unknown> | null;
    const st = doc.store as Record<string, unknown> | null;
    const ownerRaw = st?.['owner'];
    const ownerStr =
      ownerRaw != null && typeof ownerRaw === 'object' && 'toString' in ownerRaw
        ? (ownerRaw as Types.ObjectId).toString()
        : ownerRaw != null
          ? String(ownerRaw)
          : '';

    const likedByRaw = st?.['likedBy'];
    const storeLikedBy = Array.isArray(likedByRaw)
      ? likedByRaw.map((x) =>
          x != null && typeof x === 'object' && 'toString' in x
            ? (x as Types.ObjectId).toString()
            : String(x),
        )
      : [];

    const addrRaw = st?.['address'] as Record<string, unknown> | null | undefined;
    const storeAddress =
      addrRaw != null &&
      typeof addrRaw === 'object' &&
      (addrRaw['address'] != null ||
        addrRaw['city'] != null ||
        addrRaw['location'] != null)
        ? {
            _id: String(addrRaw['_id'] ?? ''),
            label: String(addrRaw['label'] ?? ''),
            address: String(addrRaw['address'] ?? ''),
            country: String(addrRaw['country'] ?? ''),
            city: String(addrRaw['city'] ?? ''),
            countryCode: String(addrRaw['countryCode'] ?? ''),
            zipCode: String(addrRaw['zipCode'] ?? ''),
            type: String(addrRaw['type'] ?? 'USER'),
            location: addrRaw['location'] ?? null,
            createdAt:
              addrRaw['createdAt'] != null ? toIso(addrRaw['createdAt']) : '',
            updatedAt:
              addrRaw['updatedAt'] != null ? toIso(addrRaw['updatedAt']) : '',
          }
        : null;

    let storeLatNum: number | undefined;
    let storeLngNum: number | undefined;
    const rawLat = st?.['latitude'];
    const rawLng = st?.['longitude'];
    if (rawLat != null && rawLng != null) {
      const la = Number(rawLat);
      const ln = Number(rawLng);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        storeLatNum = la;
        storeLngNum = ln;
      }
    }
    if (
      (storeLatNum === undefined || storeLngNum === undefined) &&
      storeAddress != null
    ) {
      const loc = storeAddress.location as Record<string, unknown> | null;
      const coords = loc?.['coordinates'];
      if (Array.isArray(coords) && coords.length >= 2) {
        const ln = Number(coords[0]);
        const la = Number(coords[1]);
        if (Number.isFinite(la) && Number.isFinite(ln)) {
          storeLatNum = la;
          storeLngNum = ln;
        }
      }
    }

    const productIdStr = String(doc._id);
    const dailyMenuToday = this._buildDailyMenuTodayForProduct(st, productIdStr);
    const distRaw = doc.distanceKm;
    const distanceKm =
      distRaw != null && Number.isFinite(Number(distRaw))
        ? Math.round(Number(distRaw) * 1000) / 1000
        : null;

    return {
      _id: productIdStr,
      id: productIdStr,
      title: String(doc.title ?? ''),
      bio: String(doc.bio ?? ''),
      originCountry: String(doc.originCountry ?? ''),
      price: Number(doc.price ?? 0),
      discountPrice: Number(doc.discountPrice ?? 0),
      currency: String(doc.currency ?? 'CAD'),
      profileImage: String(doc.profileImage ?? ''),
      status: String(doc.status ?? ''),
      createdAt: toIso(doc.createdAt),
      updatedAt: toIso(doc.updatedAt),
      likesCount: likes,
      averageRating: Number(doc.averageRating ?? 0),
      likedBy: likes > 0 ? Array.from({ length: likes }, () => '') : [],
      ratings: [] as unknown[],
      extras: [] as unknown[],
      galleryImages: [] as unknown[],
      ordersCount: 0,
      inCart: false,
      category:
        cat && cat['title'] != null
          ? {
              id: String(cat['id'] ?? cat['_id'] ?? ''),
              _id: String(cat['_id'] ?? cat['id'] ?? ''),
              title: String(cat['title'] ?? ''),
              icon: String(cat['icon'] ?? ''),
              isEnabled: cat['isEnabled'] !== false && cat['is_enabled'] !== false,
              createdAt: toIso(cat['createdAt']),
              updatedAt: toIso(cat['updatedAt']),
            }
          : {
              id: '',
              _id: '',
              title: '',
              icon: '',
              isEnabled: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
      store:
        st && st['name'] != null
          ? {
              id: String(st['id'] ?? st['_id'] ?? ''),
              _id: String(st['_id'] ?? st['id'] ?? ''),
              name: String(st['name'] ?? ''),
              status: String(st['status'] ?? ''),
              bio: String(st['bio'] ?? ''),
              acceptsOrders: st['acceptsOrders'] !== false,
              supportsShipping: st['supportsShipping'] === true,
              currency: String(st['currency'] ?? 'CAD'),
              email: String(st['email'] ?? ''),
              phoneNumber: String(st['phoneNumber'] ?? ''),
              profileImage: String(st['profileImage'] ?? ''),
              likedBy: storeLikedBy,
              address: storeAddress,
              owner: ownerStr,
              createdAt: toIso(st['createdAt']),
              updatedAt: toIso(st['updatedAt']),
              canCreateProducts: st['canCreateProducts'] === true,
              shippingZones: Array.isArray(st['shippingZones'])
                ? (st['shippingZones'] as unknown[])
                : [],
              averageRating: Number(st['averageRating'] ?? 0),
              ...(storeLatNum !== undefined && storeLngNum !== undefined
                ? {
                    latitude: storeLatNum,
                    longitude: storeLngNum,
                  }
                : {}),
            }
          : {
              id: '',
              _id: '',
              name: '',
              status: 'INACTIVE',
              bio: '',
              acceptsOrders: false,
              supportsShipping: false,
              currency: 'CAD',
              email: '',
              phoneNumber: '',
              profileImage: '',
              likedBy: [] as string[],
              address: null,
              owner: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              canCreateProducts: false,
              shippingZones: [] as unknown[],
              averageRating: 0.0,
            },
      dailyMenuToday,
      distanceKm,
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
    /** Fenêtre récente avant `$lookup` stores — évite un scan joint sur toute la collection `products`. */
    const candidateCap = Math.min(900, Math.max(safeLimit * 12, 200));
    const pipeline: PipelineStage[] = [
      { $sort: { createdAt: -1 } },
      { $limit: candidateCap },
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
      ...this._clientMarketplaceProductStoreStages(),
      ...this._productDailyMenuListingStages(),
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
      this._lookupAddressPipelineStage('$store.address', '_storeAddr'),
      {
        $addFields: {
          _storeResolvedAddr: { $arrayElemAt: ['$_storeAddr', 0] },
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
                _id: { $toString: '$_category._id' },
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
            _id: { $toString: '$store._id' },
            name: '$store.name',
            status: { $toString: '$store.status' },
            bio: { $ifNull: ['$store.bio', ''] },
            email: { $ifNull: ['$store.email', ''] },
            phoneNumber: { $ifNull: ['$store.phoneNumber', ''] },
            acceptsOrders: { $ifNull: ['$store.acceptsOrders', true] },
            supportsShipping: { $ifNull: ['$store.supportsShipping', false] },
            currency: { $ifNull: ['$store.currency', 'CAD'] },
            profileImage: { $ifNull: ['$store.profileImage', ''] },
            likedBy: { $ifNull: ['$store.likedBy', []] },
            owner: {
              $convert: {
                input: '$store.owner',
                to: 'string',
                onError: '',
                onNull: '',
              },
            },
            createdAt: '$store.createdAt',
            updatedAt: '$store.updatedAt',
            canCreateProducts: { $ifNull: ['$store.canCreateProducts', false] },
            averageRating: { $ifNull: ['$store.averageRating', 0] },
            address: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$_storeAddr', []] } }, 0] },
                {
                  _id: { $toString: '$_storeResolvedAddr._id' },
                  isDefault: {
                    $ifNull: [
                      '$_storeResolvedAddr.is_default',
                      {
                        $ifNull: ['$_storeResolvedAddr.isDefault', false],
                      },
                    ],
                  },
                  label: { $ifNull: ['$_storeResolvedAddr.label', ''] },
                  address: { $ifNull: ['$_storeResolvedAddr.address', ''] },
                  country: { $ifNull: ['$_storeResolvedAddr.country', ''] },
                  city: { $ifNull: ['$_storeResolvedAddr.city', ''] },
                  countryCode: {
                    $ifNull: [
                      '$_storeResolvedAddr.country_code',
                      {
                        $ifNull: ['$_storeResolvedAddr.countryCode', ''],
                      },
                    ],
                  },
                  zipCode: {
                    $ifNull: [
                      '$_storeResolvedAddr.zip_code',
                      {
                        $ifNull: ['$_storeResolvedAddr.zipCode', ''],
                      },
                    ],
                  },
                  type: { $ifNull: ['$_storeResolvedAddr.type', 'USER'] },
                  location: {
                    $ifNull: ['$_storeResolvedAddr.location', null],
                  },
                  createdAt: '$_storeResolvedAddr.createdAt',
                  updatedAt: '$_storeResolvedAddr.updatedAt',
                },
                null,
              ],
            },
            latitude: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $size: { $ifNull: ['$_storeAddr', []] } }, 0] },
                    {
                      $gte: [
                        {
                          $size: {
                            $ifNull: [
                              '$_storeResolvedAddr.location.coordinates',
                              [],
                            ],
                          },
                        },
                        2,
                      ],
                    },
                  ],
                },
                {
                  $arrayElemAt: [
                    '$_storeResolvedAddr.location.coordinates',
                    1,
                  ],
                },
                null,
              ],
            },
            longitude: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $size: { $ifNull: ['$_storeAddr', []] } }, 0] },
                    {
                      $gte: [
                        {
                          $size: {
                            $ifNull: [
                              '$_storeResolvedAddr.location.coordinates',
                              [],
                            ],
                          },
                        },
                        2,
                      ],
                    },
                  ],
                },
                {
                  $arrayElemAt: [
                    '$_storeResolvedAddr.location.coordinates',
                    0,
                  ],
                },
                null,
              ],
            },
          },
        },
      },
    ];

    const raw = await this._productsService
      .getProductModel()
      .aggregate(pipeline)
      .option({ allowDiskUse: true })
      .exec();

    return (raw as Record<string, unknown>[]).map((doc) =>
      this._mapHomeFeedLeanDoc(doc),
    );
  }

  /**
   * Menu boutique paginé : **une seule** agrégation ($facet), sans second `find` + `populate`
   * (réduit fortement la charge par rapport à `_filterProducts`).
   */
  async storeMenuProductsLeanPage(
    storeId: string,
    page: number,
    take: number,
    user?: UserModel,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    if (!Types.ObjectId.isValid(storeId)) {
      return { items: [], total: 0 };
    }
    if (!(await this._storeService.isStoreVisibleOnMobileApp(storeId))) {
      return { items: [], total: 0 };
    }
    const storeOid = new Types.ObjectId(storeId);
    const ownerOid = this._userObjectId(user);
    const safeTake = Math.min(120, Math.max(1, Math.floor(take)));
    const safePage = Math.max(1, Math.floor(page));
    const skip = (safePage - 1) * safeTake;

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
            { 'store._id': storeOid },
            { 'store.status': StoreStatusEnum.ACTIVE },
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
      ...productEmbeddedStoreOwnerStripeOnboardedStages(),
      ...this._productDailyMenuListingStages(),
      {
        $facet: {
          total: [{ $count: 'n' }],
          rows: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: safeTake },
            ...this._productLeanEnrichmentStages(),
          ] as any[],
        },
      },
    ];

    const agg = await this._productsService
      .getProductModel()
      .aggregate(pipeline)
      .option({ allowDiskUse: true })
      .exec();

    const bucket = agg[0] as
      | { total?: { n?: number }[]; rows?: Record<string, unknown>[] }
      | undefined;
    const total = bucket?.total?.[0]?.n ?? 0;
    const rows = bucket?.rows ?? [];
    return {
      items: rows.map((d) => this._mapHomeFeedLeanDoc(d)),
      total,
    };
  }

  private async _filterStores(
    args: SearchDto,
    user?: UserModel,
  ): Promise<SearchResultDto<StoreModel>> {
    const ownerOid = this._userObjectId(user);
    const q = args.query?.trim();
    const andParts: Record<string, unknown>[] = [
      ownerOid
        ? {
            $or: [
              { owner: ownerOid },
              { status: StoreStatusEnum.ACTIVE },
            ],
          }
        : { status: StoreStatusEnum.ACTIVE },
    ];
    if (!ownerOid) {
      andParts.push({ acceptsOrders: { $ne: false } });
    }
    if (q) {
      const esc = this._escapeRegex(q);
      andParts.push({
        $or: [
          { name: { $regex: esc, $options: 'i' } },
          { bio: { $regex: esc, $options: 'i' } },
        ],
      });
    }
    const pipeline: PipelineStage[] = [
      {
        $match: {
          $and: andParts,
        },
      },
      ...storeOwnerStripeOnboardedPipelineStages(),
      ...this._storeDistanceAndMenuStages(args),
      ...storeArticlesAvailabilityPipelineStages(),
    ];

    const sortKeys = this._storeSortKeys(args);
    const facetPipeline: PipelineStage[] = [
      ...pipeline,
      {
        $facet: {
          rows: [
            { $sort: sortKeys },
            { $skip: (args.page! - 1) * args.take! },
            { $limit: args.take! },
            {
              $lookup: {
                from: 'store_ratings',
                let: { sid: '$_id' },
                pipeline: [
                  { $match: { $expr: { $eq: ['$store', '$$sid'] } } },
                  { $project: { _id: 0, rate: 1 } },
                ],
                as: '_rates',
              },
            },
            this._lookupAddressPipelineStage('$address', '_addr'),
            {
              $addFields: {
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
                _address: { $arrayElemAt: ['$_addr', 0] },
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                bio: 1,
                email: 1,
                phoneNumber: 1,
                currency: 1,
                profileImage: 1,
                status: 1,
                acceptsOrders: 1,
                supportsShipping: 1,
                canCreateProducts: 1,
                shippingZones: 1,
                createdAt: 1,
                updatedAt: 1,
                __v: 1,
                likedBy: { $ifNull: ['$likedBy', []] },
                averageRating: 1,
                owner: {
                  $convert: {
                    input: '$owner',
                    to: 'string',
                    onError: '',
                    onNull: '',
                  },
                },
                address: {
                  $cond: [
                    { $gt: [{ $size: { $ifNull: ['$_addr', []] } }, 0] },
                    {
                      _id: { $toString: '$_address._id' },
                      isDefault: {
                        $ifNull: [
                          '$_address.is_default',
                          { $ifNull: ['$_address.isDefault', false] },
                        ],
                      },
                      label: { $ifNull: ['$_address.label', ''] },
                      address: { $ifNull: ['$_address.address', ''] },
                      country: { $ifNull: ['$_address.country', ''] },
                      city: { $ifNull: ['$_address.city', ''] },
                      countryCode: {
                        $ifNull: [
                          '$_address.country_code',
                          { $ifNull: ['$_address.countryCode', ''] },
                        ],
                      },
                      zipCode: {
                        $ifNull: [
                          '$_address.zip_code',
                          { $ifNull: ['$_address.zipCode', ''] },
                        ],
                      },
                      type: { $ifNull: ['$_address.type', 'USER'] },
                      location: { $ifNull: ['$_address.location', null] },
                      createdAt: '$_address.createdAt',
                      updatedAt: '$_address.updatedAt',
                    },
                    null,
                  ],
                },
              },
            },
          ] as any[],
          total: [{ $count: 'n' }],
        },
      },
    ];

    const agg = await this._storeService
      .getStoreModel()
      .aggregate(facetPipeline)
      .option({ allowDiskUse: true })
      .exec();

    const bucket = agg[0] as
      | {
          rows: Record<string, unknown>[];
          total: { n: number }[];
        }
      | undefined;
    const rows = bucket?.rows ?? [];
    const total = bucket?.total?.[0]?.n ?? 0;

    return {
      items: rows as unknown as StoreModel[],
      total,
      page: args.page,
      limit: args.take,
    };
  }
}
