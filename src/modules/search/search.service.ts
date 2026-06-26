import {
  productEmbeddedStoreOwnerStripeOnboardedStages,
  storeOwnerStripeOnboardedPipelineStages,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { OffersService } from '@modules/offers/offers.service';
import { DrinksService } from '@modules/drinks/drinks.service';
import { SearchSettingsService } from '@modules/search-settings/search-settings.service';
import { ProductsService } from '@modules/products/products.service';
import { StoreService } from '@modules/store/store.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  embeddedStoreRegionMatch,
  storeDirectRegionMatch,
} from '@modules/supported-countries/client-market-region.util';
import { isGeoPlausibleForCatalogRegion } from '@modules/supported-countries/catalog-geo-region.util';
import {
  AppCacheKeys,
  apiPublicCacheTtlMs,
  cacheUserScope,
  stableCacheHash,
} from '@common/redis-app-cache';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { shouldApplyCatalogRegionFilter } from '@common/catalog-public-id.util';
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
import { escapeMongoRegex } from '@common/mongo/escape-regex.util';
import {
  buildDailyMenuTodayForProduct,
  parseDailyMenuAddonsAvailability,
} from '@utils/daily-menu-today-product.util';
import {
  jsDayOfWeekInTimezone,
  resolveEffectiveTimezone,
} from '@modules/supported-countries/region-timezone.util';
import { mapInChunks } from '@utils/map-in-chunks';
import {
  productDailyMenuEnrichmentPipelineStages,
  productDailyMenuHomeFeedFallbackPipelineStages,
  productDailyMenuListingPipelineStages,
} from '@utils/product-daily-menu-listing.pipeline';
import { storeArticlesAvailabilityPipelineStages } from '@utils/store-articles-availability.pipeline';

@Injectable()
export class SearchService {
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
      la != null && ln != null && Number.isFinite(la) && Number.isFinite(ln)
    );
  }

  /** Retire le geo client s'il est incompatible avec le marché catalogue (ex. GPS simulateur au Canada + countryCode CM). */
  private _stripGeoIfOutsideCatalogRegion(
    args: SearchDto,
    region: string,
  ): void {
    if (!this._hasSearchGeo(args)) return;
    const lat = args.latitude as number;
    const lng = args.longitude as number;
    if (isGeoPlausibleForCatalogRegion(lat, lng, region)) return;
    args.latitude = undefined;
    args.longitude = undefined;
    args.maxDistanceKm = undefined;
    if (args.sortBy === SortBy.DISTANCE) {
      args.sortBy = SortBy.CREATED_AT;
      args.sortDirection = SortOrder.DESC;
    }
  }

  private _hasSearchGeoForRegion(args: SearchDto, region: string): boolean {
    if (!this._hasSearchGeo(args)) return false;
    return isGeoPlausibleForCatalogRegion(
      args.latitude as number,
      args.longitude as number,
      region,
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
  private async _productDailyMenuListingStagesAsync(): Promise<
    PipelineStage[]
  > {
    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
    return productDailyMenuListingPipelineStages(regionTimezoneMap);
  }

  private async _productDailyMenuEnrichmentStagesAsync(): Promise<
    PipelineStage[]
  > {
    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
    return productDailyMenuEnrichmentPipelineStages(regionTimezoneMap);
  }

  private async _storeArticlesAvailabilityStagesAsync(): Promise<
    PipelineStage[]
  > {
    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
    return storeArticlesAvailabilityPipelineStages(regionTimezoneMap);
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
                      $ifNull: ['$_searchGeoResAddr.location.coordinates', []],
                    },
                  },
                  2,
                ],
              },
              {
                $arrayElemAt: ['$_searchGeoResAddr.location.coordinates', 1],
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
                      $ifNull: ['$_searchGeoResAddr.location.coordinates', []],
                    },
                  },
                  2,
                ],
              },
              {
                $arrayElemAt: ['$_searchGeoResAddr.location.coordinates', 0],
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
  private async _storeDistanceAndMenuStages(
    args: SearchDto,
    region: string,
  ): Promise<PipelineStage[]> {
    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
    const effectiveTzExpr = {
      $let: {
        vars: {
          storeTz: {
            $trim: {
              input: { $ifNull: ['$timezone', ''] },
            },
          },
        },
        in: {
          $cond: [
            { $gt: [{ $strLenCP: '$$storeTz' }, 0] },
            '$$storeTz',
            {
              $switch: {
                branches: Object.entries(regionTimezoneMap).map(
                  ([code, tz]) => ({
                    case: { $eq: [{ $toUpper: '$region' }, code] },
                    then: tz,
                  }),
                ),
                default: 'America/Toronto',
              },
            },
          ],
        },
      },
    };
    const jsDay = {
      $subtract: [
        {
          $dayOfWeek: {
            date: '$$NOW',
            timezone: effectiveTzExpr,
          },
        },
        1,
      ],
    };
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
                        cond: { $eq: ['$$s.dayOfWeek', jsDay] },
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

    if (this._hasSearchGeoForRegion(args, region)) {
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
        return { createdAt: -dir as 1 | -1 };
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
        return { createdAt: -dir as 1 | -1 };
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
          estimatedCookingTime: {
            $ifNull: ['$estimated_cooking_time', '$estimatedCookingTime'],
          },
          estimatedCookingTimeUnit: {
            $ifNull: [
              '$estimated_cooking_time_unit',
              '$estimatedCookingTimeUnit',
            ],
          },
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
                  $arrayElemAt: ['$_storeResolvedAddr.location.coordinates', 1],
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
                  $arrayElemAt: ['$_storeResolvedAddr.location.coordinates', 0],
                },
                null,
              ],
            },
            dailyMenuByWeekday: {
              $ifNull: ['$store.dailyMenuByWeekday', []],
            },
          },
          distanceKm: { $ifNull: ['$distanceKm', null] },
          dailyMenuToday: {
            $cond: [
              { $eq: ['$__onDailyMenu', true] },
              {
                onMenu: true,
                stockUnlimited: {
                  $ne: [
                    { $ifNull: ['$__menuItem.stockUnlimited', true] },
                    false,
                  ],
                },
                stockRemaining: {
                  $ifNull: ['$__menuItem.stockRemaining', 0],
                },
                soldOut: { $eq: ['$__menuSoldOut', true] },
              },
              {
                onMenu: false,
                stockUnlimited: true,
                stockRemaining: 0,
                soldOut: false,
              },
            ],
          },
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

  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  @Inject(SearchSettingsService)
  private readonly _searchSettings: SearchSettingsService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  private async _applyPlatformSearchSettings(
    args: SearchDto,
    regionCode?: string,
  ): Promise<void> {
    const cfg = await this._searchSettings.getSearchRuntimeConfig();
    if (this._hasSearchGeo(args) && args.maxDistanceKm == null) {
      const regionalRadius =
        regionCode != null
          ? await this._supportedCountries.getCatalogSearchRadiusKm(regionCode)
          : null;
      args.maxDistanceKm = regionalRadius ?? cfg.defaultMaxDistanceKm;
    }
    const allowed = new Set<SearchContent>();
    if (cfg.searchProductsEnabled) allowed.add(SearchContent.PRODUCTS);
    if (cfg.searchStoresEnabled) allowed.add(SearchContent.STORES);
    if (cfg.searchDrinksEnabled) allowed.add(SearchContent.DRINKS);
    if (cfg.searchOffersEnabled) allowed.add(SearchContent.OFFERS);
    args.searchContent = args.searchContent.filter((c) => allowed.has(c));
    const q = args.query?.trim() ?? '';
    if (
      q.length > 0 &&
      q.length < cfg.minQueryLength &&
      !cfg.vectorSearchEnabled
    ) {
      args.query = '';
    }
  }

  private _isSearchFilterCacheable(args: SearchDto): boolean {
    if (args.query?.trim()) return false;
    if (args.latitude != null || args.longitude != null) return false;
    if (args.sortBy === SortBy.DISTANCE) return false;
    return true;
  }

  async filter(args: SearchDto, user?: UserModel) {
    args.page = args.page ?? 1;
    args.take = args.take ?? 5;
    const clientRegion =
      await this._supportedCountries.resolveClientCatalogRegion(
        user,
        args.countryCode,
      );
    await this._applyPlatformSearchSettings(args, clientRegion);
    this._stripGeoIfOutsideCatalogRegion(args, clientRegion);
    this._normalizeSearchGeoArgs(args);
    if (this._isSearchFilterCacheable(args)) {
      const scope = cacheUserScope(user);
      const hash = stableCacheHash({
        scope,
        clientRegion,
        searchContent: args.searchContent,
        storeId: args.storeId ?? '',
        categoryId: args.categoryId ?? '',
        minPrice: args.minPrice ?? null,
        maxPrice: args.maxPrice ?? null,
        sortBy: args.sortBy ?? null,
        sortDirection: args.sortDirection ?? null,
        page: args.page,
        take: args.take,
      });
      return this._cacheLayer.getOrSet(
        'publicCatalog',
        AppCacheKeys.searchFilter(hash),
        apiPublicCacheTtlMs(),
        () => this._filterUncached(args, user, clientRegion),
      );
    }
    return this._filterUncached(args, user, clientRegion);
  }

  private async _filterUncached(
    args: SearchDto,
    user?: UserModel,
    clientRegion?: string,
  ) {
    const region =
      clientRegion ??
      (await this._supportedCountries.resolveClientCatalogRegion(
        user,
        args.countryCode,
      ));
    const searchContent = args.searchContent;
    // console.log('🚀 ~ SearchService ~ filter ~ args:', searchContent);
    const response: {
      [key: string]:
        | SearchResultDto<ProductModel>
        | SearchResultDto<StoreModel>
        | SearchResultDto<OfferModel>
        | SearchResultDto<Record<string, unknown>>;
    } = {};

    if (searchContent.includes(SearchContent.PRODUCTS)) {
      response.products = await this._filterProducts(args, user, region);
    }

    if (searchContent.includes(SearchContent.DRINKS)) {
      response.drinks = await this._drinksService.filterMarketplaceCatalog(
        args,
        region,
      );
    }

    if (searchContent.includes(SearchContent.STORES)) {
      response.stores = await this._filterStores(args, user, region);
    }

    if (searchContent.includes(SearchContent.OFFERS)) {
      response.offers = await this._filterOffers(args, user, region);
    }

    return response;
  }

  private async _filterOffers(
    args: SearchDto,
    user?: UserModel,
    clientRegion?: string,
  ) {
    const region =
      clientRegion ??
      (await this._supportedCountries.resolveClientCatalogRegion(
        user,
        args.countryCode,
      ));
    const ownerOid = this._userObjectId(user);
    const queryEsc = escapeMongoRegex(args.query ?? '');
    const pipeline: PipelineStage[] = [
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
              store: new Types.ObjectId(args.storeId),
            },
            {
              $or: [
                { title: { $regex: queryEsc, $options: 'i' } },
                { bio: { $regex: queryEsc, $options: 'i' } },
                { about: { $regex: queryEsc, $options: 'i' } },
              ],
            },
          ].filter(Boolean),
        },
      },
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
      { $match: embeddedStoreRegionMatch(region) },
      {
        $project: {
          _id: 1,
        },
      },
    ];

    const [facetAgg] = await this._offersService
      .getModel()
      .aggregate([
        ...pipeline,
        {
          $facet: {
            rows: [
              { $skip: (args.page! - 1) * args.take! },
              { $limit: args.take! },
            ],
            total: [{ $count: 'n' }],
          },
        },
      ])
      .exec();
    const facet = facetAgg as
      | { rows?: { _id: Types.ObjectId }[]; total?: { n: number }[] }
      | undefined;
    const offerIds = facet?.rows ?? [];
    const count = facet?.total?.[0]?.n ?? 0;

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
    clientRegion?: string,
  ): Promise<SearchResultDto<ProductModel>> {
    const region =
      clientRegion ??
      (await this._supportedCountries.resolveClientCatalogRegion(
        user,
        args.countryCode,
      ));
    const queryEsc = escapeMongoRegex(args.query ?? '');
    const dailyMenuStages = await this._productDailyMenuListingStagesAsync();
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
            { status: ProductStatusEnum.ACTIVE },
            {
              'store.acceptsOrders': true,
            },
            args.categoryId && {
              category: { $eq: new Types.ObjectId(args.categoryId) },
            },
            {
              $or: [
                { title: { $regex: queryEsc, $options: 'i' } },
                { bio: { $regex: queryEsc, $options: 'i' } },
                { about: { $regex: queryEsc, $options: 'i' } },
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
            embeddedStoreRegionMatch(region),
          ].filter(Boolean),
        },
      },
      ...this._clientMarketplaceProductStoreStages(),
      ...dailyMenuStages,
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

    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
    const items = leanRows.map((doc) =>
      this._mapHomeFeedLeanDoc(doc, regionTimezoneMap),
    );

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

  private _parseDailyMenuAddonsAvailability(
    raw: unknown,
  ):
    | {
        variantIndexes?: number[];
        complements?: { groupIndex: number; optionIndexes: number[] }[];
        supplementIndexes?: number[];
      }
    | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    const out: {
      variantIndexes?: number[];
      complements?: { groupIndex: number; optionIndexes: number[] }[];
      supplementIndexes?: number[];
    } = {};
    if (Array.isArray(o.variantIndexes) && o.variantIndexes.length) {
      out.variantIndexes = [
        ...new Set(
          o.variantIndexes
            .map((n) => Math.floor(Number(n)))
            .filter((n) => n >= 0),
        ),
      ].sort((a, b) => a - b);
    }
    if (Array.isArray(o.complements) && o.complements.length) {
      const groups = (o.complements as unknown[])
        .map((row) => {
          const r = row as Record<string, unknown>;
          return {
            groupIndex: Math.floor(Number(r.groupIndex)),
            optionIndexes: [
              ...new Set(
                (Array.isArray(r.optionIndexes) ? r.optionIndexes : [])
                  .map((n) => Math.floor(Number(n)))
                  .filter((n) => n >= 0),
              ),
            ].sort((a, b) => a - b),
          };
        })
        .filter((g) => g.groupIndex >= 0 && g.optionIndexes.length > 0)
        .sort((a, b) => a.groupIndex - b.groupIndex);
      if (groups.length) out.complements = groups;
    }
    if (Array.isArray(o.supplementIndexes) && o.supplementIndexes.length) {
      out.supplementIndexes = [
        ...new Set(
          o.supplementIndexes
            .map((n) => Math.floor(Number(n)))
            .filter((n) => n >= 0),
        ),
      ].sort((a, b) => a - b);
    }
    return Object.keys(out).length ? out : undefined;
  }

  private _buildDailyMenuTodayForProduct(
    storeRaw: Record<string, unknown> | null | undefined,
    productId: string,
    timezone?: string,
  ): {
    onMenu: boolean;
    stockUnlimited: boolean;
    stockRemaining: number;
    soldOut: boolean;
    addonsAvailability?: {
      variantIndexes?: number[];
      complements?: { groupIndex: number; optionIndexes: number[] }[];
      supplementIndexes?: number[];
    };
  } {
    if (timezone) {
      return buildDailyMenuTodayForProduct(storeRaw, productId, new Date(), timezone);
    }
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
    const addonsAvailability = this._parseDailyMenuAddonsAvailability(
      it['addonsAvailability'],
    );
    return {
      onMenu: true,
      stockUnlimited,
      stockRemaining,
      soldOut,
      ...(addonsAvailability ? { addonsAvailability } : {}),
    };
  }

  /** Normalise une ligne d’agrégation « home feed » / menu boutique (JSON client, sans BSON). */
  private _cookingTimeFieldsFromDoc(
    doc: Record<string, unknown>,
  ): {
    estimatedCookingTime?: number;
    estimatedCookingTimeUnit?: string;
  } {
    const n = Number(
      doc.estimatedCookingTime ?? doc.estimated_cooking_time,
    );
    const rawUnit =
      doc.estimatedCookingTimeUnit ?? doc.estimated_cooking_time_unit;
    const u = typeof rawUnit === 'string' ? rawUnit.trim() : '';
    if (!Number.isFinite(n) || n < 1 || !['s', 'm', 'h'].includes(u)) {
      return {};
    }
    return {
      estimatedCookingTime: Math.floor(n),
      estimatedCookingTimeUnit: u,
    };
  }

  private _mapHomeFeedLeanDoc(
    doc: Record<string, unknown>,
    regionTimezoneMap?: Record<string, string>,
  ): Record<string, unknown> {
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

    const addrRaw = st?.['address'] as
      | Record<string, unknown>
      | null
      | undefined;
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
    const precomputed = doc['dailyMenuToday'] as
      | Record<string, unknown>
      | undefined;
    const dailyMenuToday =
      precomputed != null &&
      typeof precomputed === 'object' &&
      precomputed['onMenu'] === true
        ? {
            onMenu: true,
            stockUnlimited: precomputed['stockUnlimited'] !== false,
            stockRemaining: Math.max(
              0,
              Math.floor(Number(precomputed['stockRemaining'] ?? 0)),
            ),
            soldOut: precomputed['soldOut'] === true,
            ...(parseDailyMenuAddonsAvailability(
              precomputed['addonsAvailability'],
            )
              ? {
                  addonsAvailability: parseDailyMenuAddonsAvailability(
                    precomputed['addonsAvailability'],
                  ),
                }
              : {}),
          }
        : buildDailyMenuTodayForProduct(
            st,
            productIdStr,
            new Date(),
            resolveEffectiveTimezone({
              storeTimezone:
                typeof st?.['timezone'] === 'string'
                  ? String(st['timezone'])
                  : undefined,
              regionTimezone: (() => {
                const code =
                  typeof st?.['region'] === 'string'
                    ? String(st['region']).trim().toUpperCase()
                    : '';
                return code && regionTimezoneMap?.[code]
                  ? regionTimezoneMap[code]
                  : undefined;
              })(),
              regionCode:
                typeof st?.['region'] === 'string'
                  ? String(st['region'])
                  : undefined,
            }),
          );
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
      ...this._cookingTimeFieldsFromDoc(doc),
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
              isEnabled:
                cat['isEnabled'] !== false && cat['is_enabled'] !== false,
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
              acceptsMealPreOrders:
                st['acceptsMealPreOrders'] === true ||
                st['acceptsPreProgrammedFoodDeliveries'] === true,
              acceptsPickupPayOnDelivery:
                st['acceptsPickupPayOnDelivery'] === true ||
                st['accepts_pickup_pay_on_delivery'] === true,
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
              paymentsReady: true,
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
              acceptsMealPreOrders: false,
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
    clientRegion?: string,
  ): Promise<Record<string, unknown>[]> {
    const safeLimit = Math.min(120, Math.max(1, Math.floor(limit)));
    const scope = cacheUserScope(user);
    const region =
      clientRegion ??
      (await this._supportedCountries.resolveClientCatalogRegion(user));
    return this._cacheLayer.getOrSet(
      'publicCatalog',
      AppCacheKeys.homeFeed(scope, safeLimit, region),
      apiPublicCacheTtlMs(),
      () => this._homeFeedProductsUncached(user, safeLimit, region),
    );
  }

  private async _homeFeedProductsUncached(
    user?: UserModel,
    safeLimit = 48,
    clientRegion?: string,
  ): Promise<Record<string, unknown>[]> {
    const strict = await this._aggregateHomeFeedProducts(
      user,
      safeLimit,
      clientRegion,
      'strict',
    );
    if (strict.length > 0) return strict;
    return this._aggregateHomeFeedProducts(
      user,
      safeLimit,
      clientRegion,
      'fallback',
    );
  }

  private async _aggregateHomeFeedProducts(
    user?: UserModel,
    safeLimit = 48,
    clientRegion?: string,
    mode: 'strict' | 'fallback' = 'strict',
  ): Promise<Record<string, unknown>[]> {
    const region =
      clientRegion ??
      (await this._supportedCountries.resolveClientCatalogRegion(user));
    /** Fenêtre récente avant `$lookup` stores — évite un scan joint sur toute la collection `products`. */
    const candidateCap = Math.min(900, Math.max(safeLimit * 12, 200));
    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
    const dailyMenuStages =
      mode === 'strict'
        ? productDailyMenuListingPipelineStages(regionTimezoneMap)
        : productDailyMenuHomeFeedFallbackPipelineStages(regionTimezoneMap);
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
            { status: ProductStatusEnum.ACTIVE },
            { 'store.acceptsOrders': true },
            {
              $or: [
                { title: { $regex: '', $options: 'i' } },
                { bio: { $regex: '', $options: 'i' } },
                { about: { $regex: '', $options: 'i' } },
              ],
            },
            embeddedStoreRegionMatch(region),
          ],
        },
      },
      ...this._clientMarketplaceProductStoreStages(),
      ...dailyMenuStages,
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
          estimatedCookingTime: {
            $ifNull: ['$estimated_cooking_time', '$estimatedCookingTime'],
          },
          estimatedCookingTimeUnit: {
            $ifNull: [
              '$estimated_cooking_time_unit',
              '$estimatedCookingTimeUnit',
            ],
          },
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
                  $arrayElemAt: ['$_storeResolvedAddr.location.coordinates', 1],
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
                  $arrayElemAt: ['$_storeResolvedAddr.location.coordinates', 0],
                },
                null,
              ],
            },
          },
          dailyMenuToday: {
            $cond: [
              {
                $eq: [{ $size: { $ifNull: ['$__todaySlotItems', []] } }, 0],
              },
              null,
              {
                $cond: [
                  { $eq: ['$__onDailyMenu', true] },
                  {
                    onMenu: true,
                    stockUnlimited: {
                      $ne: [
                        { $ifNull: ['$__menuItem.stockUnlimited', true] },
                        false,
                      ],
                    },
                    stockRemaining: {
                      $ifNull: ['$__menuItem.stockRemaining', 0],
                    },
                    soldOut: { $eq: ['$__menuSoldOut', true] },
                  },
                  {
                    onMenu: false,
                    stockUnlimited: true,
                    stockRemaining: 0,
                    soldOut: false,
                  },
                ],
              },
            ],
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
      this._mapHomeFeedLeanDoc(doc, regionTimezoneMap),
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
    query?: string,
    clientPlatform?: string,
    countryCode?: string,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    if (!Types.ObjectId.isValid(storeId)) {
      return { items: [], total: 0 };
    }
    const clientRegion = shouldApplyCatalogRegionFilter(
      clientPlatform,
      countryCode,
    )
      ? await this._supportedCountries.resolveClientCatalogRegion(
          user,
          countryCode,
        )
      : undefined;
    if (
      !(await this._storeService.isStoreVisibleForClient(
        storeId,
        clientPlatform,
        clientRegion,
      ))
    ) {
      return { items: [], total: 0 };
    }
    const q = query?.trim();
    if (!q) {
      const safeTake = Math.min(120, Math.max(1, Math.floor(take)));
      const safePage = Math.max(1, Math.floor(page));
      const scope =
        cacheUserScope(user) +
        (clientPlatform === 'web' ? ':web-catalog' : ':client-catalog');
      return this._cacheLayer.getOrSet(
        'publicCatalog',
        AppCacheKeys.storeMenuPage(storeId, safePage, safeTake, scope),
        apiPublicCacheTtlMs(),
        () =>
          this._storeMenuProductsLeanPageWithDailyMenuFallback(
            storeId,
            safePage,
            safeTake,
            user,
            clientPlatform,
          ),
      );
    }
    return this._storeMenuProductsLeanPageUncached(
      storeId,
      page,
      take,
      user,
      query,
      clientPlatform,
      true,
    );
  }

  /**
   * Menu du jour en priorité ; si aucun plat planifié aujourd’hui, catalogue actif
   * de la boutique (sans lien avec la pré-commande).
   */
  private async _storeMenuProductsLeanPageWithDailyMenuFallback(
    storeId: string,
    page: number,
    take: number,
    user?: UserModel,
    clientPlatform?: string,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const dailyOnly = await this._storeMenuProductsLeanPageUncached(
      storeId,
      page,
      take,
      user,
      undefined,
      clientPlatform,
      true,
    );
    if (dailyOnly.total > 0) {
      return dailyOnly;
    }
    return this._storeMenuProductsLeanPageUncached(
      storeId,
      page,
      take,
      user,
      undefined,
      clientPlatform,
      false,
    );
  }

  private async _storeMenuProductsLeanPageUncached(
    storeId: string,
    page: number,
    take: number,
    user?: UserModel,
    query?: string,
    clientPlatform?: string,
    dailyMenuOnly = true,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    if (!Types.ObjectId.isValid(storeId)) {
      return { items: [], total: 0 };
    }
    if (!(await this._storeService.isStoreVisibleForClient(storeId, clientPlatform))) {
      return { items: [], total: 0 };
    }
    const storeOid = new Types.ObjectId(storeId);
    const ownerOid = this._userObjectId(user);
    const safeTake = Math.min(120, Math.max(1, Math.floor(take)));
    const safePage = Math.max(1, Math.floor(page));
    const skip = (safePage - 1) * safeTake;
    const q = query?.trim();
    const textClause = q
      ? {
          $or: [
            { title: { $regex: escapeMongoRegex(q), $options: 'i' } },
            { bio: { $regex: escapeMongoRegex(q), $options: 'i' } },
            { about: { $regex: escapeMongoRegex(q), $options: 'i' } },
          ],
        }
      : {
          $or: [
            { title: { $regex: '', $options: 'i' } },
            { bio: { $regex: '', $options: 'i' } },
            { about: { $regex: '', $options: 'i' } },
          ],
        };

    const dailyMenuStages = dailyMenuOnly
      ? await this._productDailyMenuListingStagesAsync()
      : await this._productDailyMenuEnrichmentStagesAsync();
    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
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
            textClause,
          ],
        },
      },
      ...productEmbeddedStoreOwnerStripeOnboardedStages(),
      ...dailyMenuStages,
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
      items: rows.map((d) => this._mapHomeFeedLeanDoc(d, regionTimezoneMap)),
      total,
    };
  }

  private async _filterStores(
    args: SearchDto,
    user?: UserModel,
    clientRegion?: string,
  ): Promise<SearchResultDto<StoreModel>> {
    const region =
      clientRegion ??
      (await this._supportedCountries.resolveClientCatalogRegion(
        user,
        args.countryCode,
      ));
    const q = args.query?.trim();
    /** Catalogue client : ACTIVE + commandes + Stripe Connect + au moins un article commandable. */
    const andParts: Record<string, unknown>[] = [
      { status: StoreStatusEnum.ACTIVE },
      { acceptsOrders: { $ne: false } },
      storeDirectRegionMatch(region),
    ];
    if (q) {
      const esc = escapeMongoRegex(q);
      andParts.push({
        $or: [
          { name: { $regex: esc, $options: 'i' } },
          { bio: { $regex: esc, $options: 'i' } },
        ],
      });
    }
    const storeDistanceStages = await this._storeDistanceAndMenuStages(
      args,
      region,
    );
    const pipeline: PipelineStage[] = [
      {
        $match: {
          $and: andParts,
        },
      },
      ...storeOwnerStripeOnboardedPipelineStages(),
      ...storeDistanceStages,
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
                timezone: 1,
                working_hours: 1,
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
