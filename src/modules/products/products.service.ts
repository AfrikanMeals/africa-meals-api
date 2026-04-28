import { MediasService } from '@modules/medias/medias.service';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { RatingsService } from '@modules/ratings/ratings.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import type { FavoriteListingPagePayload } from './dto/favorite-listing.payload';
import {
  CreateProductDto,
  CreateProductExtraDto,
  PatchProductDto,
} from './dto/products.dto';

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

  @Inject(CACHE_MANAGER)
  private readonly _cacheManager: Cache;

  /** Incrémenté à chaque ajout/retrait favori : invalide les clés cache mémoire (TTL + génération). */
  private readonly _favoriteListRevision = new Map<string, number>();

  /** Taille max fichier image avant encodage base64 (5 Mo). */
  private static readonly MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  /** Au plus 2 fichiers en galerie (3 images au total avec la principale). */
  private static readonly MAX_GALLERY_FILES = 2;

  private async uploadGalleryToFirebase(
    files: Express.Multer.File[] | undefined,
    user: UserModel,
    basePath: string,
  ): Promise<{ items: Array<{ imageUrl: string }>; uploadedUrls: string[] }> {
    const uploadedUrls: string[] = [];
    const items: Array<{ imageUrl: string }> = [];
    if (!files?.length) {
      return { items, uploadedUrls };
    }
    for (const f of files.slice(0, ProductsService.MAX_GALLERY_FILES)) {
      const imgBytes = f.buffer?.length ?? f.size ?? 0;
      if (imgBytes > ProductsService.MAX_IMAGE_BYTES) {
        for (const u of uploadedUrls) {
          await this._mediasService.delete(u).catch(() => undefined);
        }
        throw new BadRequestException('image_too_large');
      }
      const url = await this._mediasService.upload(
        f,
        user,
        `${basePath}/gallery`,
      );
      if (!url) {
        for (const u of uploadedUrls) {
          await this._mediasService.delete(u).catch(() => undefined);
        }
        throw new BadRequestException('error_uploading_image');
      }
      uploadedUrls.push(url);
      items.push({ imageUrl: url });
    }
    return { items, uploadedUrls };
  }

  private async deleteRemoteGalleryItems(rawGallery: unknown[]) {
    if (!Array.isArray(rawGallery)) return;
    for (const g of rawGallery) {
      const row = g as Record<string, unknown>;
      const u =
        typeof row.imageUrl === 'string'
          ? row.imageUrl
          : typeof row.image_url === 'string'
            ? row.image_url
            : '';
      if (u.startsWith('http')) {
        await this._mediasService.delete(u).catch(() => undefined);
      }
    }
  }

  getProductModel() {
    return this._productModel;
  }

  getProductCategoryModel() {
    return this._productCategoryModel;
  }

  async findOneById(id: string) {
    return await this._productModel
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

  /** Liste catalogue vendeur (document allégé + catégorie peuplée). */
  async findByStoreId(storeId: string) {
    const rows = await this._productModel
      .find({ store: storeId })
      .populate({ path: 'category', select: 'title' })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return rows.map((p: Record<string, unknown>) => {
      const cat = p.category as Record<string, unknown> | undefined;
      const catId =
        cat?._id != null
          ? String(cat._id)
          : p.category != null
            ? String(p.category)
            : '';
      const catTitle =
        cat && typeof cat.title === 'string' ? cat.title : '';
      const mime =
        typeof p.imageMimeType === 'string'
          ? p.imageMimeType
          : typeof p.image_mime_type === 'string'
            ? p.image_mime_type
            : '';
      const b64 =
        typeof p.imageBase64 === 'string'
          ? p.imageBase64
          : typeof p.image_base64 === 'string'
            ? p.image_base64
            : '';
      const imageFromDb =
        mime && b64 ? `data:${mime};base64,${b64}` : undefined;
      const urlImage =
        typeof p.profileImage === 'string'
          ? p.profileImage
          : typeof p.profile_image === 'string'
            ? p.profile_image
            : undefined;
      const mainSrc = imageFromDb ?? urlImage;
      const rawGallery =
        (p.galleryImages as unknown[]) ??
        (p.gallery_images as unknown[]) ??
        [];
      const galleryUrls: string[] = [];
      if (Array.isArray(rawGallery)) {
        for (const g of rawGallery) {
          const row = g as Record<string, unknown>;
          const gUrl =
            typeof row.imageUrl === 'string'
              ? row.imageUrl
              : typeof row.image_url === 'string'
                ? row.image_url
                : '';
          if (gUrl) {
            galleryUrls.push(gUrl);
            continue;
          }
          const gm =
            typeof row.imageMimeType === 'string'
              ? row.imageMimeType
              : typeof row.image_mime_type === 'string'
                ? row.image_mime_type
                : '';
          const gb =
            typeof row.imageBase64 === 'string'
              ? row.imageBase64
              : typeof row.image_base64 === 'string'
                ? row.image_base64
                : '';
          if (gm && gb) {
            galleryUrls.push(`data:${gm};base64,${gb}`);
          }
        }
      }
      const profileImages = [
        ...(mainSrc ? [mainSrc] : []),
        ...galleryUrls,
      ];
      const galleryHasBase64InDb =
        Array.isArray(rawGallery) &&
        rawGallery.some((g) => {
          const row = g as Record<string, unknown>;
          const gb =
            typeof row.imageBase64 === 'string'
              ? row.imageBase64
              : typeof row.image_base64 === 'string'
                ? row.image_base64
                : '';
          return Boolean(gb);
        });
      return {
        id: String(p._id),
        title: String(p.title ?? ''),
        bio: String(p.bio ?? ''),
        about: String(p.about ?? ''),
        originCountry: String(
          p.originCountry ?? p.origin_country ?? '',
        ),
        price: Number(p.price ?? 0),
        discountPrice: Number(
          p.discountPrice ?? p.discount_price ?? 0,
        ),
        currency: String(p.currency ?? 'CAD'),
        status: String(p.status ?? ProductStatusEnum.PENDING),
        categoryId: catId,
        categoryTitle: catTitle,
        profileImage: mainSrc,
        profileImages,
        imageMimeType: mime || undefined,
        imageStoredInDb: Boolean(b64) || galleryHasBase64InDb,
        createdAt:
          p.createdAt instanceof Date
            ? p.createdAt.toISOString()
            : typeof p.createdAt === 'string'
              ? p.createdAt
              : undefined,
        updatedAt:
          p.updatedAt instanceof Date
            ? p.updatedAt.toISOString()
            : typeof p.updatedAt === 'string'
              ? p.updatedAt
              : undefined,
      };
    });
  }

  async create(
    args: CreateProductDto,
    user: UserModel,
    store: StoreModel,
    image?: Express.Multer.File,
    gallery?: Express.Multer.File[],
  ) {
    const category = await this._productCategoryModel
      .findOne({ _id: args.category })
      .exec();

    if (!category) {
      throw new NotFoundException('category_not_found');
    }

    const storeId = store._id.toString();
    const basePath = `stores/${storeId}/products`;
    const uploadedUrls: string[] = [];
    let profileImage: string | undefined;
    try {
      if (image) {
        const imgBytes = image.buffer?.length ?? image.size ?? 0;
        if (imgBytes > ProductsService.MAX_IMAGE_BYTES) {
          throw new BadRequestException('image_too_large');
        }
        const url = await this._mediasService.upload(image, user, basePath);
        if (!url) {
          throw new BadRequestException('error_uploading_image');
        }
        uploadedUrls.push(url);
        profileImage = url;
      }

      const { items: galleryItems, uploadedUrls: gUrls } =
        await this.uploadGalleryToFirebase(gallery, user, basePath);
      uploadedUrls.push(...gUrls);

      const originCountry = args.originCountry ?? store.address.country;

      const product = await this._productModel.create({
        title: args.title,
        bio: args.bio,
        about: args.about,
        originCountry,
        price: Number(args.price),
        discountPrice:
          args.discountPrice != null ? Number(args.discountPrice) : 0,
        category: category._id,
        store: store._id,
        currency: (args.currency?.trim() || store.currency) as string,
        status: args.status ?? ProductStatusEnum.PENDING,
        ...(profileImage && { profileImage }),
        ...(galleryItems.length > 0 && { galleryImages: galleryItems }),
      });

      return this.findOneById(product._id.toString());
    } catch (e) {
      for (const u of uploadedUrls) {
        await this._mediasService.delete(u).catch(() => undefined);
      }
      throw e;
    }
  }

  async updateForVendor(
    productId: string,
    storeId: string,
    args: PatchProductDto,
    user: UserModel,
    store: StoreModel,
    image?: Express.Multer.File,
    gallery?: Express.Multer.File[],
  ) {
    const doc = await this._productModel
      .findOne({ _id: productId, store: storeId })
      .exec();
    if (!doc) {
      throw new NotFoundException('product_not_found');
    }

    if (args.title != null && args.title.trim() !== doc.title) {
      const dup = await this._productModel
        .findOne({
          title: args.title.trim(),
          store: storeId,
          _id: { $ne: productId },
        })
        .exec();
      if (dup) {
        throw new ConflictException('product_already_exists');
      }
      doc.title = args.title.trim();
    }

    if (args.category != null) {
      const category = await this._productCategoryModel
        .findOne({ _id: args.category })
        .exec();
      if (!category) {
        throw new NotFoundException('category_not_found');
      }
      doc.set('category', category._id);
    }

    if (args.bio != null) {
      doc.bio = args.bio.trim();
    }
    if (args.about !== undefined) {
      doc.about = args.about?.trim() ?? '';
    }
    if (args.originCountry != null) {
      doc.originCountry = args.originCountry.trim();
    }
    if (args.price !== undefined) {
      doc.price = Number(args.price);
    }
    if (args.discountPrice !== undefined) {
      doc.discountPrice = Number(args.discountPrice);
    }
    if (args.currency != null) {
      doc.currency = args.currency.trim();
    }
    if (args.status !== undefined) {
      doc.status = args.status;
    }

    if (image) {
      const imgBytes = image.buffer?.length ?? image.size ?? 0;
      if (imgBytes > ProductsService.MAX_IMAGE_BYTES) {
        throw new BadRequestException('image_too_large');
      }
      if (doc.profileImage?.startsWith('http')) {
        await this._mediasService
          .delete(doc.profileImage)
          .catch(() => undefined);
      }
      doc.set('imageMimeType', undefined);
      doc.set('imageBase64', undefined);
      const url = await this._mediasService.upload(
        image,
        user,
        `stores/${storeId}/products`,
      );
      if (!url) {
        throw new BadRequestException('error_uploading_image');
      }
      doc.set('profileImage', url);
    }

    const rawExistingGallery =
      (doc.galleryImages as unknown[])?.slice() ?? [];
    if (gallery && gallery.length > 0) {
      await this.deleteRemoteGalleryItems(rawExistingGallery);
      const { items } = await this.uploadGalleryToFirebase(
        gallery,
        user,
        `stores/${storeId}/products`,
      );
      doc.set('galleryImages', items);
    } else if (args.clearGallery === true) {
      await this.deleteRemoteGalleryItems(rawExistingGallery);
      doc.set('galleryImages', []);
    }

    await doc.save();
    return this.findOneById(productId);
  }

  async deleteForVendor(productId: string, storeId: string) {
    const doc = await this._productModel
      .findOne({ _id: productId, store: storeId })
      .exec();
    if (!doc) {
      throw new NotFoundException('product_not_found');
    }
    if (doc.profileImage?.startsWith('http')) {
      await this._mediasService.delete(doc.profileImage).catch(() => undefined);
    }
    await this.deleteRemoteGalleryItems(
      (doc.galleryImages as unknown[]) ?? [],
    );
    await doc.deleteOne();
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

    await this._productModel
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

    return this.findOneById(product._id.toString());
  }

  async deleteExtra(id: string, extraId: string, user: UserModel) {
    const product = await this._productModel
      .findOne({
        _id: id,
        extras: {
          // _id: extraId,
          // $elemMatch: { title: { $regex: new RegExp(`^${extraId}$`, 'i') } },
          $elemMatch: { _id: new Types.ObjectId(extraId) },
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
              _id: extraId,
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

  private bumpFavoriteListCache(userId: Types.ObjectId | string) {
    const id =
      typeof userId === 'string' ? userId : (userId as Types.ObjectId).toString();
    this._favoriteListRevision.set(
      id,
      (this._favoriteListRevision.get(id) ?? 0) + 1,
    );
  }

  private favoritesCacheKey(
    userId: string,
    pagination?: { page: number; take: number },
  ) {
    const gen = this._favoriteListRevision.get(userId) ?? 0;
    if (pagination) {
      return `favlist:${userId}:${gen}:${pagination.page}:${pagination.take}`;
    }
    return `favlist:${userId}:${gen}:all`;
  }

  private favoritesGraphqlCacheKey(
    userId: string,
    pagination: { page: number; take: number },
  ) {
    const gen = this._favoriteListRevision.get(userId) ?? 0;
    return `favlistgql:${userId}:${gen}:${pagination.page}:${pagination.take}`;
  }

  /**
   * Agrégation Mongo : une passe paginée, lookups limités (pas de populate Mongoose lourd),
   * champs alignés sur l’écran liste favoris uniquement.
   */
  async listFavoriteProductsListingForGraphql(
    user: UserModel,
    page: number,
    take: number,
  ): Promise<FavoriteListingPagePayload> {
    const userId = user?._id as Types.ObjectId | undefined;
    if (!userId) {
      throw new BadRequestException('user_not_found');
    }
    const uid = userId.toString();
    const cacheKey = this.favoritesGraphqlCacheKey(uid, { page, take });
    const hit = await this._cacheManager.get<FavoriteListingPagePayload>(
      cacheKey,
    );
    if (hit != null) {
      return hit;
    }

    const skip = (page - 1) * take;
    const pipeline: PipelineStage[] = [
      { $match: { likedBy: userId, status: ProductStatusEnum.ACTIVE } },
      {
        $facet: {
          meta: [{ $count: 'total' }],
          data: [
            { $sort: { updatedAt: -1 } },
            { $skip: skip },
            { $limit: take },
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
                from: 'stores',
                localField: 'store',
                foreignField: '_id',
                as: '_st',
              },
            },
            {
              $lookup: {
                from: 'product_ratings',
                let: { pid: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: { $eq: ['$product', '$$pid'] },
                    },
                  },
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
              },
            },
            {
              $addFields: {
                categoryPayload: {
                  $cond: [
                    { $gt: [{ $size: { $ifNull: ['$_cat', []] } }, 0] },
                    {
                      id: {
                        $toString: { $arrayElemAt: ['$_cat._id', 0] },
                      },
                      title: { $arrayElemAt: ['$_cat.title', 0] },
                      icon: { $arrayElemAt: ['$_cat.icon', 0] },
                      isEnabled: {
                        $ifNull: [
                          { $arrayElemAt: ['$_cat.isEnabled', 0] },
                          true,
                        ],
                      },
                    },
                    null,
                  ],
                },
                storePayload: {
                  $cond: [
                    { $gt: [{ $size: { $ifNull: ['$_st', []] } }, 0] },
                    {
                      id: {
                        $toString: { $arrayElemAt: ['$_st._id', 0] },
                      },
                      name: { $arrayElemAt: ['$_st.name', 0] },
                      status: {
                        $toString: { $arrayElemAt: ['$_st.status', 0] },
                      },
                    },
                    null,
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                title: 1,
                profileImage: 1,
                price: 1,
                discountPrice: { $ifNull: ['$discountPrice', 0] },
                currency: 1,
                bio: 1,
                originCountry: { $ifNull: ['$originCountry', ''] },
                likesCount: 1,
                averageRating: { $ifNull: ['$averageRating', 0] },
                inCart: { $literal: false },
                category: '$categoryPayload',
                store: '$storePayload',
              },
            },
          ],
        },
      },
      {
        $project: {
          total: {
            $ifNull: [
              {
                $let: {
                  vars: { m: { $arrayElemAt: ['$meta', 0] } },
                  in: '$$m.total',
                },
              },
              0,
            ],
          },
          data: 1,
        },
      },
    ];

    const agg = await this._productModel.aggregate(pipeline).exec();
    const pack = agg[0] as { total?: number; data?: Record<string, unknown>[] };
    const total = typeof pack?.total === 'number' ? pack.total : 0;
    const rawItems = Array.isArray(pack?.data) ? pack.data : [];

    const items = rawItems.map((doc) => {
      const cat = doc.category as Record<string, unknown> | null | undefined;
      const st = doc.store as Record<string, unknown> | null | undefined;
      return {
        id: String(doc._id),
        title: String(doc.title ?? ''),
        profileImage:
          typeof doc.profileImage === 'string' ? doc.profileImage : '',
        price: Number(doc.price ?? 0),
        discountPrice: Number(doc.discountPrice ?? 0),
        currency: String(doc.currency ?? 'CAD'),
        bio: String(doc.bio ?? ''),
        originCountry: String(doc.originCountry ?? ''),
        likesCount: Number(doc.likesCount ?? 0),
        averageRating: Number(doc.averageRating ?? 0),
        inCart: Boolean(doc.inCart),
        category:
          cat && typeof cat.id === 'string'
            ? {
                id: cat.id,
                title: String(cat.title ?? ''),
                icon: String(cat.icon ?? ''),
                isEnabled: cat.isEnabled !== false,
              }
            : null,
        store:
          st && typeof st.id === 'string'
            ? {
                id: st.id,
                name: String(st.name ?? ''),
                status: String(st.status ?? ''),
              }
            : null,
      };
    });

    const result: FavoriteListingPagePayload = {
      items,
      total,
      page,
      limit: take,
    };

    const ttlEnv = Number(process.env.FAVORITES_CACHE_TTL_MS);
    const ttlMs = Number.isFinite(ttlEnv) && ttlEnv > 0 ? ttlEnv : 25_000;
    await this._cacheManager.set(cacheKey, result, ttlMs);
    return result;
  }

  /**
   * Requête allégée pour la liste favoris : pas de populate `likedBy` ni `ratings.user`,
   * médias base64 exclus, galerie réduite aux URLs (payload JSON plus léger + moins d’I/O Mongo).
   */
  private baseFavoriteProductsQuery(userId: Types.ObjectId) {
    const filter = {
      likedBy: userId,
      status: ProductStatusEnum.ACTIVE,
    };
    return this._productModel
      .find(filter)
      .select('-imageBase64 -imageMimeType')
      .populate({
        path: 'category',
        select: 'title icon isEnabled createdAt updatedAt',
      })
      .populate({
        path: 'ratings',
        select: '_id rate createdAt updatedAt product',
      })
      .populate({ path: 'store' })
      .sort({ updatedAt: -1 })
      .lean({ virtuals: true });
  }

  private stripHeavyFavoriteProductFields(
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return rows.map((row) => {
      const out: Record<string, unknown> = { ...row };
      const g = out['galleryImages'];
      if (Array.isArray(g) && g.length) {
        out['galleryImages'] = g
          .map((item: unknown) => {
            if (item && typeof item === 'object' && 'imageUrl' in item) {
              const u = String(
                (item as { imageUrl?: string }).imageUrl ?? '',
              ).trim();
              return u ? { imageUrl: u } : null;
            }
            return null;
          })
          .filter(Boolean);
      }
      delete out['imageBase64'];
      delete out['imageMimeType'];
      return out;
    });
  }

  async listFavoriteProducts(
    user: UserModel,
    pagination?: { page: number; take: number },
  ) {
    const userId = user?._id as Types.ObjectId | undefined;
    if (!userId) {
      throw new BadRequestException('user_not_found');
    }
    const uid = userId.toString();
    const cacheKey = this.favoritesCacheKey(uid, pagination);
    const cached = await this._cacheManager.get<unknown>(cacheKey);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const filter = {
      likedBy: userId,
      status: ProductStatusEnum.ACTIVE,
    };
    const baseQuery = this.baseFavoriteProductsQuery(userId);

    const ttlEnv = Number(process.env.FAVORITES_CACHE_TTL_MS);
    const ttlMs = Number.isFinite(ttlEnv) && ttlEnv > 0 ? ttlEnv : 25_000;

    let result: unknown;
    if (pagination) {
      const { page, take } = pagination;
      const skip = (page - 1) * take;
      const [data, total] = await Promise.all([
        baseQuery.clone().skip(skip).limit(take).exec(),
        this._productModel.countDocuments(filter).exec(),
      ]);
      result = {
        data: this.stripHeavyFavoriteProductFields(
          data as unknown as Record<string, unknown>[],
        ),
        total,
        page,
        limit: take,
      };
    } else {
      const raw = await baseQuery.clone().limit(500).exec();
      result = this.stripHeavyFavoriteProductFields(
        raw as unknown as Record<string, unknown>[],
      );
    }

    await this._cacheManager.set(cacheKey, result, ttlMs);
    return result;
  }

  async addToFavorites(productId: string, user: UserModel) {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('product_not_found');
    }
    const product = await this._productModel
      .findOne({ _id: productId, status: ProductStatusEnum.ACTIVE })
      .exec();
    if (!product) {
      throw new NotFoundException('product_not_found');
    }
    await this._productModel
      .updateOne(
        { _id: productId },
        {
          $addToSet: {
            likedBy: user._id,
          },
        },
      )
      .exec();
    this.bumpFavoriteListCache(user._id as Types.ObjectId);
    return this.findOneById(productId);
  }

  async removeFromFavorites(productId: string, user: UserModel) {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('product_not_found');
    }
    const product = await this._productModel.findOne({ _id: productId }).exec();
    if (!product) {
      throw new NotFoundException('product_not_found');
    }
    await this._productModel
      .updateOne(
        { _id: productId },
        {
          $pull: {
            likedBy: user._id,
          },
        },
      )
      .exec();
    this.bumpFavoriteListCache(user._id as Types.ObjectId);
    return this.findOneById(productId);
  }
}
