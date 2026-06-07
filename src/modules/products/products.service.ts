import { prepareIncomingUploadFile } from 'src/incoming-upload-file';
import { MediasService } from '@modules/medias/medias.service';
import {
  AppCacheKeys,
  apiPublicCacheTtlMs,
  bustCacheKey,
  getOrSetCache,
} from '@common/redis-app-cache';
import { CreateRatingDto } from '@modules/ratings/dto/ratings.dto';
import { isDemoProductRaterEmail } from '@modules/ratings/demo-product-rating-users';
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
import { productEmbeddedStoreOwnerStripeOnboardedStages } from '@modules/billing/stripe/stripe-connect-visibility';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import type { FavoriteListingPagePayload } from './dto/favorite-listing.payload';
import { buildDailyMenuTodayForProduct } from '@utils/daily-menu-today-product.util';
import { productDailyMenuListingPipelineStages } from '@utils/product-daily-menu-listing.pipeline';
import {
  CreateProductDto,
  CreateProductExtraDto,
  PatchProductDto,
} from './dto/products.dto';
import { ProductDiscountScheduleService } from './product-discount-schedule.service';

@Injectable()
export class ProductsService {
  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(RatingsService)
  private readonly _ratingsService: RatingsService;

  @Inject(CACHE_MANAGER)
  private readonly _cacheManager: Cache;

  @Inject(ProductDiscountScheduleService)
  private readonly _discountSchedules: ProductDiscountScheduleService;

  /** Incrémenté à chaque ajout/retrait favori : invalide les clés cache mémoire (TTL + génération). */
  private readonly _favoriteListRevision = new Map<string, number>();

  /** Évite plusieurs agrégations Mongo en parallèle pour la même clé (cache froid). */
  private readonly _favoriteListInflight = new Map<string, Promise<unknown>>();

  private async runWithFavoriteListDedupe<T>(
    cacheKey: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const cached = await this._cacheManager.get<T>(cacheKey);
    if (cached !== undefined && cached !== null) {
      return cached;
    }
    const pending = this._favoriteListInflight.get(cacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
    const task = (async () => {
      try {
        const res = await factory();
        await this._cacheManager.set(cacheKey, res, ttlMs);
        return res;
      } finally {
        this._favoriteListInflight.delete(cacheKey);
      }
    })();
    this._favoriteListInflight.set(cacheKey, task);
    return task;
  }

  /**
   * Lookups catégorie + boutique + moyenne des notes (sans charger toutes les lignes `product_ratings`).
   */
  /** Lookup boutique + filtre menu du jour (stock > 0) avant pagination catalogue. */
  private buildFavoriteProductsDailyMenuPreFilterStages(): PipelineStage[] {
    return [
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
          'store.status': StoreStatusEnum.ACTIVE,
          'store.acceptsOrders': { $ne: false },
        },
      },
      ...productEmbeddedStoreOwnerStripeOnboardedStages(),
      ...productDailyMenuListingPipelineStages(),
    ];
  }

  private buildFavoriteProductsSharedLookupsAndMetricsStages(
    skipStoreLookup = false,
  ): PipelineStage[] {
    return [
      {
        $lookup: {
          from: 'product_categories',
          localField: 'category',
          foreignField: '_id',
          as: '_cat',
        },
      },
      ...(skipStoreLookup
        ? [{ $addFields: { _st: ['$store'] } } as PipelineStage]
        : [
            {
              $lookup: {
                from: 'stores',
                localField: 'store',
                foreignField: '_id',
                as: '_st',
              },
            } as PipelineStage,
          ]),
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
            {
              $group: {
                _id: null,
                avgRate: { $avg: '$rate' },
              },
            },
          ],
          as: '_rateAgg',
        },
      },
      {
        $addFields: {
          likesCount: { $size: { $ifNull: ['$likedBy', []] } },
          averageRating: {
            $ifNull: [{ $arrayElemAt: ['$_rateAgg.avgRate', 0] }, 0],
          },
          galleryImages: {
            $filter: {
              input: {
                $map: {
                  input: { $ifNull: ['$galleryImages', []] },
                  as: 'g',
                  in: {
                    $cond: [
                      {
                        $gt: [
                          {
                            $strLenCP: {
                              $trim: {
                                input: {
                                  $ifNull: [
                                    {
                                      $convert: {
                                        input: '$$g.imageUrl',
                                        to: 'string',
                                        onError: '',
                                        onNull: '',
                                      },
                                    },
                                    '',
                                  ],
                                },
                              },
                            },
                          },
                          0,
                        ],
                      },
                      { imageUrl: '$$g.imageUrl' },
                      null,
                    ],
                  },
                },
              },
              as: 'item',
              cond: { $ne: ['$$item', null] },
            },
          },
        },
      },
    ];
  }

  /** Taille max fichier image avant encodage base64 (5 Mo). */
  private static readonly MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  /** Au plus 2 fichiers en galerie (3 images au total avec la principale). */
  private static readonly MAX_GALLERY_FILES = 2;

  private static uploadByteLength(file: Express.Multer.File): number {
    const prepared = prepareIncomingUploadFile(file);
    return prepared.buffer?.length ?? prepared.size ?? 0;
  }

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
      const imgBytes = ProductsService.uploadByteLength(f);
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

  /** Détail plat boutique — compléments / suppléments normalisés pour l’app mobile. */
  async getProductDetailForShop(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('product_not_found');
    }
    return getOrSetCache(
      this._cacheManager,
      AppCacheKeys.productDetail(id),
      apiPublicCacheTtlMs(),
      () => this._loadProductDetailForShop(id),
    );
  }

  private async _bustProductDetailCache(productId: string): Promise<void> {
    await bustCacheKey(
      this._cacheManager,
      AppCacheKeys.productDetail(productId),
    );
  }

  private async _loadProductDetailForShop(id: string) {
    const doc = await this.findOneById(id);
    if (!doc) {
      throw new NotFoundException('product_not_found');
    }
    const obj = doc.toObject({ virtuals: true }) as Record<string, unknown>;
    const storeRef = obj.store as Record<string, unknown> | { _id?: unknown } | undefined;
    const storeId =
      storeRef != null && typeof storeRef === 'object'
        ? String(
            (storeRef as { _id?: unknown })._id ??
              (storeRef as { id?: unknown }).id ??
              '',
          ).trim()
        : '';
    let dailyMenuRows: unknown = undefined;
    if (storeId && Types.ObjectId.isValid(storeId)) {
      const storeLean = await this._storeModel
        .findById(storeId)
        .select('dailyMenuByWeekday')
        .lean()
        .exec();
      dailyMenuRows =
        (storeLean as { dailyMenuByWeekday?: unknown } | null)
          ?.dailyMenuByWeekday ??
        (storeLean as { daily_menu_by_weekday?: unknown } | null)
          ?.daily_menu_by_weekday;
    }
    if (dailyMenuRows == null && storeRef != null && typeof storeRef === 'object') {
      dailyMenuRows =
        (storeRef as Record<string, unknown>)['dailyMenuByWeekday'] ??
        (storeRef as Record<string, unknown>)['daily_menu_by_weekday'];
    }
    const dailyMenuToday = buildDailyMenuTodayForProduct(
      dailyMenuRows != null ? { dailyMenuByWeekday: dailyMenuRows } : null,
      String(doc._id),
    );
    return {
      ...obj,
      id: String(doc._id),
      dailyMenuToday,
      complements: this.normalizeComplements(obj.complements),
      supplements: this.normalizeSupplements(obj.supplements),
      variants: this.normalizeVariants(obj.variants),
      variantsLabel: String(obj.variantsLabel ?? obj.variants_label ?? ''),
      usesVariants: this.normalizeVariants(obj.variants).length > 0,
      ...this.effectivePriceFromVariants(
        Number(obj.price ?? 0),
        Number(obj.discountPrice ?? obj.discount_price ?? 0),
        obj.variants,
      ),
      fieldsets: this.normalizeFieldsets(obj.fieldsets),
      listPrice: this._discountSchedules.resolveListPrice(
        obj as unknown as ProductModel,
      ),
      listDiscountPrice: this._discountSchedules.resolveListDiscountPrice(
        obj as unknown as ProductModel,
      ),
      discountSchedules: this._discountSchedules.schedulesForResponse(
        obj.discountSchedules ?? obj.discount_schedules,
      ),
    };
  }

  async findOneById(id: string) {
    const doc = await this._productModel
      .findOne({ _id: id })
      .populate('category')
      .populate({
        path: 'ratings',
        options: { limit: 120, sort: { createdAt: -1 } },
        populate: {
          path: 'user',
          select: 'fullName profileImage email',
        },
      })
      .populate('likedBy')
      .populate({
        path: 'store',
        populate: { path: 'address' },
      })
      .exec();
    if (doc?.ratings?.length) {
      type RWithUser = { user?: { email?: string } };
      const kept = (doc.ratings as unknown as RWithUser[]).filter(
        (r) => !isDemoProductRaterEmail(r?.user?.email),
      );
      doc.set('ratings', kept as typeof doc.ratings);
    }
    return doc;
  }

  async existsInStore(title: string, storeId: string) {
    return this._productModel
      .findOne({ title, store: { _id: storeId } })
      .exec();
  }

  private _escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeFieldsets(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0);
  }

  private normalizeComplements(raw: unknown): Array<{
    title: string;
    firstOptionFree: boolean;
    multiChoice: boolean;
    required: boolean;
    options: Array<{ label: string; priceDelta: number; isDefault: boolean }>;
  }> {
    if (!Array.isArray(raw)) return [];
    const groups: Array<{
      title: string;
      firstOptionFree: boolean;
      multiChoice: boolean;
      required: boolean;
      options: Array<{ label: string; priceDelta: number; isDefault: boolean }>;
    }> = [];
    for (const g of raw) {
      const row = (g ?? {}) as Record<string, unknown>;
      const title = String(row.title ?? '').trim();
      if (!title) continue;
      const firstOptionFree = Boolean(
        row.firstOptionFree ?? row.first_option_free ?? false,
      );
      const multiChoice = Boolean(
        row.multiChoice ?? row.multi_choice ?? false,
      );
      const required =
        row.required === true || row.is_required === true;
      const rawOptions = Array.isArray(row.options) ? row.options : [];
      const options = rawOptions
        .map((o) => {
          const opt = (o ?? {}) as Record<string, unknown>;
          const label = String(opt.label ?? '').trim();
          if (!label) return null;
          const numeric = Number(opt.priceDelta ?? opt.price_delta ?? 0);
          const priceDelta =
            Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
          return {
            label,
            priceDelta,
            isDefault: Boolean(opt.isDefault ?? opt.is_default),
          };
        })
        .filter(
          (
            o,
          ): o is { label: string; priceDelta: number; isDefault: boolean } =>
            Boolean(o),
        );
      if (!options.length) continue;
      let defaultIndex = options.findIndex((o) => o.isDefault);
      if (defaultIndex < 0) defaultIndex = 0;
      const normalizedOptions = options.map((o, index) => ({
        ...o,
        isDefault: index === defaultIndex,
      }));
      groups.push({
        title,
        firstOptionFree,
        multiChoice,
        required,
        options: normalizedOptions,
      });
    }
    return groups;
  }

  private normalizeSupplements(
    raw: unknown,
  ): Array<{ name: string; price: number }> {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s) => {
        const row = (s ?? {}) as Record<string, unknown>;
        const name = String(row.name ?? '').trim();
        if (!name) return null;
        const numeric = Number(row.price ?? 0);
        const price = Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
        return { name, price };
      })
      .filter((s): s is { name: string; price: number } => Boolean(s));
  }

  normalizeVariants(raw: unknown): Array<{
    label: string;
    price: number;
    discountPrice: number;
    isDefault: boolean;
  }> {
    if (!Array.isArray(raw)) return [];
    const items: Array<{
      label: string;
      price: number;
      discountPrice: number;
      isDefault: boolean;
    }> = [];
    for (const row of raw) {
      const r = (row ?? {}) as Record<string, unknown>;
      const label = String(r.label ?? r.name ?? '').trim();
      if (!label) continue;
      const priceNum = Number(r.price ?? 0);
      const price = Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0;
      const discNum = Number(r.discountPrice ?? r.discount_price ?? 0);
      let discountPrice =
        Number.isFinite(discNum) && discNum >= 0 ? discNum : 0;
      if (discountPrice > 0 && discountPrice >= price) {
        discountPrice = 0;
      }
      items.push({
        label,
        price,
        discountPrice,
        isDefault: Boolean(r.isDefault ?? r.is_default),
      });
    }
    if (!items.length) return [];
    let defaultIndex = items.findIndex((v) => v.isDefault);
    if (defaultIndex < 0) defaultIndex = 0;
    return items.map((v, i) => ({
      ...v,
      isDefault: i === defaultIndex,
    }));
  }

  private pickDefaultVariant(
    variants: Array<{
      label: string;
      price: number;
      discountPrice: number;
      isDefault: boolean;
    }>,
  ) {
    if (!variants.length) return null;
    return variants.find((v) => v.isDefault) ?? variants[0];
  }

  private effectivePriceFromVariants(
    basePrice: number,
    baseDiscountPrice: number,
    rawVariants: unknown,
  ): {
    price: number;
    discountPrice: number;
    basePrice: number;
    baseDiscountPrice: number;
    usesVariants: boolean;
  } {
    const variants = this.normalizeVariants(rawVariants);
    if (!variants.length) {
      return {
        price: basePrice,
        discountPrice: baseDiscountPrice,
        basePrice,
        baseDiscountPrice,
        usesVariants: false,
      };
    }
    const def = this.pickDefaultVariant(variants);
    if (!def) {
      return {
        price: basePrice,
        discountPrice: baseDiscountPrice,
        basePrice,
        baseDiscountPrice,
        usesVariants: true,
      };
    }
    return {
      price: def.price,
      discountPrice: def.discountPrice,
      basePrice,
      baseDiscountPrice,
      usesVariants: true,
    };
  }

  private mapVendorProductRow(
    p: Record<string, unknown>,
    forcedCurrency?: string,
  ) {
    const cat = p.category as Record<string, unknown> | undefined;
    const catId =
      cat?._id != null
        ? String(cat._id)
        : p.category != null
        ? String(p.category)
        : '';
    const catTitle = cat && typeof cat.title === 'string' ? cat.title : '';
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
    const imageFromDb = mime && b64 ? `data:${mime};base64,${b64}` : undefined;
    const urlImage =
      typeof p.profileImage === 'string'
        ? p.profileImage
        : typeof p.profile_image === 'string'
        ? p.profile_image
        : undefined;
    const mainSrc = imageFromDb ?? urlImage;
    const rawGallery =
      (p.galleryImages as unknown[]) ?? (p.gallery_images as unknown[]) ?? [];
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
    const profileImages = [...(mainSrc ? [mainSrc] : []), ...galleryUrls];
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
    const rawPrice = Number(p.price ?? 0);
    const rawDiscount = Number(p.discountPrice ?? p.discount_price ?? 0);
    const variants = this.normalizeVariants(p.variants);
    const pricing = this.effectivePriceFromVariants(
      rawPrice,
      rawDiscount,
      variants,
    );
    return {
      id: String(p._id),
      title: String(p.title ?? ''),
      bio: String(p.bio ?? ''),
      about: String(p.about ?? ''),
      fieldsets: this.normalizeFieldsets(p.fieldsets),
      complements: this.normalizeComplements(p.complements),
      supplements: this.normalizeSupplements(p.supplements),
      variants,
      variantsLabel: String(p.variantsLabel ?? p.variants_label ?? ''),
      usesVariants: pricing.usesVariants,
      originCountry: String(p.originCountry ?? p.origin_country ?? ''),
      basePrice: pricing.basePrice,
      baseDiscountPrice: pricing.baseDiscountPrice,
      price: pricing.price,
      discountPrice: pricing.discountPrice,
      listPrice: Number(
        p.listPrice ?? p.list_price ?? p.price ?? 0,
      ),
      listDiscountPrice: Number(
        p.listDiscountPrice ??
          p.list_discount_price ??
          p.discountPrice ??
          p.discount_price ??
          0,
      ),
      discountSchedules: this._discountSchedules.schedulesForResponse(
        p.discountSchedules ?? p.discount_schedules,
      ),
      currency: String(forcedCurrency || p.currency || 'CAD'),
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
  }

  /** Détail plat — propriétaire (sans base64, URLs galerie uniquement). */
  async findOneForStoreOwner(storeId: string, productId: string) {
    if (
      !Types.ObjectId.isValid(storeId) ||
      !Types.ObjectId.isValid(productId)
    ) {
      throw new NotFoundException('product_not_found');
    }
    const row = await this._productModel
      .findOne({
        _id: new Types.ObjectId(productId),
        store: storeId,
      })
      .populate({ path: 'category', select: 'title' })
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException('product_not_found');
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('currency')
      .lean()
      .exec();
    const mapped = this.mapVendorProductRow(
      row as Record<string, unknown>,
      String(store?.currency ?? 'CAD'),
    );
    const main =
      typeof mapped.profileImage === 'string' &&
      (mapped.profileImage.startsWith('http://') ||
        mapped.profileImage.startsWith('https://'))
        ? mapped.profileImage
        : undefined;
    const gallery = (mapped.profileImages ?? []).filter(
      (u) =>
        typeof u === 'string' &&
        (u.startsWith('http://') || u.startsWith('https://')),
    );
    return {
      ...mapped,
      profileImage: main,
      profileImages: gallery,
      imageStoredInDb: false,
    };
  }

  /** Liste catalogue vendeur (document allégé + catégorie peuplée). */
  async findByStoreId(storeId: string) {
    const rows = await this._productModel
      .find({ store: storeId })
      .populate({ path: 'category', select: 'title' })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    const store = await this._storeModel
      .findById(storeId)
      .select('currency')
      .lean()
      .exec();
    const storeCurrency = String(store?.currency ?? 'CAD');
    return rows.map((p) =>
      this.mapVendorProductRow(p as Record<string, unknown>, storeCurrency),
    );
  }

  /** Ligne liste catalogue mobile (sans base64 ni galerie). */
  private mapVendorCatalogListRow(
    p: Record<string, unknown>,
    forcedCurrency?: string,
  ) {
    const cat = p.category as Record<string, unknown> | undefined;
    const catTitle =
      typeof p.categoryTitle === 'string'
        ? p.categoryTitle
        : cat && typeof cat.title === 'string'
        ? cat.title
        : '';
    const url =
      typeof p.profileImage === 'string'
        ? p.profileImage
        : typeof p.profile_image === 'string'
        ? p.profile_image
        : '';
    const profileImage =
      url.startsWith('http://') || url.startsWith('https://') ? url : undefined;
    const catId =
      cat?._id != null
        ? String(cat._id)
        : p.category != null
        ? String(p.category)
        : '';
    return {
      id: String(p._id ?? p.id ?? ''),
      title: String(p.title ?? ''),
      bio: String(p.bio ?? ''),
      about: String(p.about ?? ''),
      fieldsets: this.normalizeFieldsets(p.fieldsets),
      complements: this.normalizeComplements(p.complements),
      supplements: this.normalizeSupplements(p.supplements),
      variants: this.normalizeVariants(p.variants),
      variantsLabel: String(p.variantsLabel ?? p.variants_label ?? ''),
      usesVariants: this.normalizeVariants(p.variants).length > 0,
      ...this.effectivePriceFromVariants(
        Number(p.price ?? 0),
        Number(p.discountPrice ?? p.discount_price ?? 0),
        p.variants,
      ),
      currency: String(forcedCurrency || p.currency || 'CAD'),
      status: String(p.status ?? ProductStatusEnum.PENDING),
      categoryId: catId,
      categoryTitle: catTitle,
      averageRating: Number(p.averageRating ?? 0),
      ...(profileImage ? { profileImage } : {}),
    };
  }

  /**
   * Catalogue vendeur mobile : une agrégation ($facet), champs minimaux,
   * jamais `image_base64` / `gallery_images`.
   */
  async findByStoreIdPaginated(
    storeId: string,
    opts: {
      page: number;
      take: number;
      q?: string;
      productIds?: string[];
    },
  ) {
    const storeOid = Types.ObjectId.isValid(storeId)
      ? new Types.ObjectId(storeId)
      : null;
    if (!storeOid) {
      return { items: [], total: 0, page: 1, limit: opts.take };
    }

    const ids = (opts.productIds ?? [])
      .map((x) => x.trim())
      .filter((x) => Types.ObjectId.isValid(x));
    if (opts.productIds != null && !ids.length) {
      return { items: [], total: 0, page: 1, limit: opts.take };
    }

    const match: Record<string, unknown> = { store: storeOid };
    if (opts.productIds != null) {
      match._id = { $in: ids.map((id) => new Types.ObjectId(id)) };
    }
    const q = opts.q?.trim();
    if (q) {
      const esc = this._escapeRegex(q);
      const or: Record<string, unknown>[] = [
        { title: { $regex: esc, $options: 'i' } },
        { bio: { $regex: esc, $options: 'i' } },
        { about: { $regex: esc, $options: 'i' } },
      ];
      const categoryIds = await this._productCategoryModel
        .find({ title: { $regex: esc, $options: 'i' } })
        .select('_id')
        .lean()
        .exec();
      if (categoryIds.length) {
        or.push({
          category: { $in: categoryIds.map((c) => c._id) },
        });
      }
      match.$or = or;
    }

    const page = Math.max(1, opts.page);
    const take = Math.min(80, Math.max(8, opts.take));
    const skip = (page - 1) * take;

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'product_categories',
          localField: 'category',
          foreignField: '_id',
          as: 'cat',
          pipeline: [{ $project: { title: 1 } }],
        },
      },
      {
        $facet: {
          total: [{ $count: 'n' }],
          rows: [
            { $sort: { updatedAt: -1 } },
            { $skip: skip },
            { $limit: take },
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
                  {
                    $group: {
                      _id: null,
                      avgRate: { $avg: '$rate' },
                    },
                  },
                ],
                as: '_rateAgg',
              },
            },
            {
              $addFields: {
                averageRating: {
                  $ifNull: [{ $arrayElemAt: ['$_rateAgg.avgRate', 0] }, 0],
                },
              },
            },
            {
              $project: {
                _id: 1,
                title: 1,
                price: 1,
                discount_price: 1,
                discountPrice: 1,
                currency: 1,
                status: 1,
                profile_image: 1,
                profileImage: 1,
                bio: 1,
                about: 1,
                category: 1,
                averageRating: 1,
                categoryTitle: {
                  $ifNull: [{ $arrayElemAt: ['$cat.title', 0] }, ''],
                },
              },
            },
          ],
        },
      },
    ];

    const agg = await this._productModel.aggregate(pipeline).exec();
    const bucket = agg[0] as
      | { total?: { n?: number }[]; rows?: Record<string, unknown>[] }
      | undefined;
    const total = bucket?.total?.[0]?.n ?? 0;
    const rows = bucket?.rows ?? [];
    const store = await this._storeModel
      .findById(storeId)
      .select('currency')
      .lean()
      .exec();
    const storeCurrency = String(store?.currency ?? 'CAD');

    return {
      items: rows.map((p) => this.mapVendorCatalogListRow(p, storeCurrency)),
      total,
      page,
      limit: take,
    };
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
        const imgBytes = ProductsService.uploadByteLength(image);
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

      const listPrice = Number(args.listPrice ?? args.price);
      const listDiscountPrice = Number(
        args.listDiscountPrice ?? args.discountPrice ?? 0,
      );
      const discountSchedules =
        this._discountSchedules.normalizeSchedulesFromDto(
          args.discountSchedules,
        );

      const product = await this._productModel.create({
        title: args.title,
        bio: args.bio,
        about: args.about,
        fieldsets: this.normalizeFieldsets(args.fieldsets),
        complements: this.normalizeComplements(args.complements),
        supplements: this.normalizeSupplements(args.supplements),
        variants: this.normalizeVariants(args.variants),
        variantsLabel: (args.variantsLabel ?? '').trim(),
        originCountry,
        price: listPrice,
        discountPrice: listDiscountPrice,
        listPrice,
        listDiscountPrice,
        discountSchedules,
        category: category._id,
        store: store._id,
        // Devise harmonisée: toujours la devise de la boutique.
        currency: (store.currency || 'CAD') as string,
        status: args.status ?? ProductStatusEnum.ACTIVE,
        ...(profileImage && { profileImage }),
        ...(galleryItems.length > 0 && { galleryImages: galleryItems }),
      });

      const fresh = await this._productModel.findById(product._id).exec();
      if (fresh) {
        this._discountSchedules.applyToDocument(fresh);
        await fresh.save();
      }

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
    if (args.fieldsets !== undefined) {
      doc.set('fieldsets', this.normalizeFieldsets(args.fieldsets));
    }
    if (args.complements !== undefined) {
      doc.set('complements', this.normalizeComplements(args.complements));
    }
    if (args.supplements !== undefined) {
      doc.set('supplements', this.normalizeSupplements(args.supplements));
    }
    if (args.variants !== undefined) {
      doc.set('variants', this.normalizeVariants(args.variants));
    }
    if (args.variantsLabel !== undefined) {
      doc.set('variantsLabel', (args.variantsLabel ?? '').trim());
    }
    if (args.originCountry != null) {
      doc.originCountry = args.originCountry.trim();
    }
    if (args.listPrice !== undefined) {
      doc.listPrice = Number(args.listPrice);
    }
    if (args.listDiscountPrice !== undefined) {
      doc.listDiscountPrice = Number(args.listDiscountPrice);
    }
    if (args.discountSchedules !== undefined) {
      doc.set(
        'discountSchedules',
        this._discountSchedules.normalizeSchedulesFromDto(args.discountSchedules),
      );
    }
    if (args.price !== undefined) {
      const price = Number(args.price);
      doc.price = price;
      const active = this._discountSchedules.pickActiveSchedule(
        this._discountSchedules.normalizeSchedules(doc.discountSchedules),
      );
      if (!active) {
        doc.listPrice = price;
      }
    }
    if (args.discountPrice !== undefined) {
      const promo = Number(args.discountPrice);
      doc.discountPrice = promo;
      const active = this._discountSchedules.pickActiveSchedule(
        this._discountSchedules.normalizeSchedules(doc.discountSchedules),
      );
      if (!active) {
        doc.listDiscountPrice = promo;
      }
    }
    // Ignore toute devise envoyée par le client vendeur et garde la devise boutique.
    doc.currency = (store.currency || 'CAD') as string;
    if (args.status !== undefined) {
      doc.status = args.status;
    }

    if (image) {
      const imgBytes = ProductsService.uploadByteLength(image);
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

    const rawExistingGallery = (doc.galleryImages as unknown[])?.slice() ?? [];
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

    this._discountSchedules.applyToDocument(doc);
    await doc.save();
    await this._bustProductDetailCache(productId);
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
    await this.deleteRemoteGalleryItems((doc.galleryImages as unknown[]) ?? []);
    await doc.deleteOne();
    await this._bustProductDetailCache(productId);
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
      if (e instanceof ConflictException || e instanceof NotFoundException) {
        throw e;
      }
      throw new BadRequestException('error_creating_rating');
    }
  }

  private bumpFavoriteListCache(userId: Types.ObjectId | string) {
    const id =
      typeof userId === 'string'
        ? userId
        : (userId as Types.ObjectId).toString();
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
    const ttlEnv = Number(process.env.FAVORITES_CACHE_TTL_MS);
    const ttlMs = Number.isFinite(ttlEnv) && ttlEnv > 0 ? ttlEnv : 25_000;

    return this.runWithFavoriteListDedupe(cacheKey, ttlMs, async () => {
      const skip = (page - 1) * take;
      const pipeline: PipelineStage[] = [
        { $match: { likedBy: userId, status: ProductStatusEnum.ACTIVE } },
        ...this.buildFavoriteProductsDailyMenuPreFilterStages(),
        {
          $facet: {
            meta: [{ $count: 'total' }],
            data: [
              { $sort: { updatedAt: -1 } },
              { $skip: skip },
              { $limit: take },
              ...this.buildFavoriteProductsSharedLookupsAndMetricsStages(true),
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
            ] as any[],
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

      const agg = await this._productModel
        .aggregate(pipeline)
        .hint({ likedBy: 1, status: 1, updatedAt: -1 })
        .option({ allowDiskUse: true })
        .exec();
      const pack = agg[0] as {
        total?: number;
        data?: Record<string, unknown>[];
      };
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
      return result;
    });
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
    const ttlEnv = Number(process.env.FAVORITES_CACHE_TTL_MS);
    const ttlMs = Number.isFinite(ttlEnv) && ttlEnv > 0 ? ttlEnv : 25_000;

    return this.runWithFavoriteListDedupe(cacheKey, ttlMs, async () => {
      const skip = pagination ? (pagination.page - 1) * pagination.take : 0;
      const limit = pagination ? pagination.take : 500;

      const dataStages: PipelineStage[] = [
        { $sort: { updatedAt: -1 } },
        ...(skip > 0 ? [{ $skip: skip } as PipelineStage] : []),
        { $limit: limit },
        ...this.buildFavoriteProductsSharedLookupsAndMetricsStages(true),
        {
          $addFields: {
            category: {
              $let: {
                vars: { c0: { $arrayElemAt: ['$_cat', 0] } },
                in: {
                  $cond: [
                    { $ne: ['$$c0', null] },
                    {
                      _id: '$$c0._id',
                      id: { $toString: '$$c0._id' },
                      title: { $ifNull: ['$$c0.title', ''] },
                      icon: { $ifNull: ['$$c0.icon', ''] },
                      isEnabled: {
                        $ifNull: [
                          {
                            $ifNull: ['$$c0.isEnabled', '$$c0.is_enabled'],
                          },
                          true,
                        ],
                      },
                      createdAt: '$$c0.createdAt',
                      updatedAt: '$$c0.updatedAt',
                    },
                    {
                      id: '',
                      title: '',
                      icon: '',
                      isEnabled: true,
                      createdAt: null,
                      updatedAt: null,
                    },
                  ],
                },
              },
            },
            store: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ['$_st', []] } }, 0] },
                {
                  $let: {
                    vars: { st0: { $arrayElemAt: ['$_st', 0] } },
                    in: {
                      _id: '$$st0._id',
                      id: { $toString: '$$st0._id' },
                      name: { $ifNull: ['$$st0.name', ''] },
                      bio: { $ifNull: ['$$st0.bio', ''] },
                      email: { $ifNull: ['$$st0.email', ''] },
                      phoneNumber: {
                        $ifNull: [
                          {
                            $ifNull: [
                              '$$st0.phoneNumber',
                              '$$st0.phone_number',
                            ],
                          },
                          '',
                        ],
                      },
                      currency: { $ifNull: ['$$st0.currency', 'CAD'] },
                      profileImage: {
                        $ifNull: [
                          {
                            $ifNull: [
                              '$$st0.profileImage',
                              '$$st0.profile_image',
                            ],
                          },
                          '',
                        ],
                      },
                      acceptsOrders: {
                        $ifNull: [
                          {
                            $ifNull: [
                              '$$st0.acceptsOrders',
                              '$$st0.accepts_orders',
                            ],
                          },
                          false,
                        ],
                      },
                      canCreateProducts: {
                        $ifNull: [
                          {
                            $ifNull: [
                              '$$st0.canCreateProducts',
                              '$$st0.can_create_products',
                            ],
                          },
                          false,
                        ],
                      },
                      supportsShipping: {
                        $ifNull: [
                          {
                            $ifNull: [
                              '$$st0.supportsShipping',
                              '$$st0.supports_shipping',
                            ],
                          },
                          false,
                        ],
                      },
                      status: {
                        $toString: {
                          $ifNull: ['$$st0.status', 'INACTIVE'],
                        },
                      },
                      address: '$$st0.address',
                      owner: '$$st0.owner',
                      likedBy: {
                        $ifNull: [
                          {
                            $ifNull: ['$$st0.likedBy', '$$st0.liked_by'],
                          },
                          [],
                        ],
                      },
                      shippingZones: {
                        $map: {
                          input: {
                            $ifNull: [
                              {
                                $ifNull: [
                                  '$$st0.shippingZones',
                                  '$$st0.shipping_zones',
                                ],
                              },
                              [],
                            ],
                          },
                          as: 'z',
                          in: {
                            minDistance: {
                              $ifNull: [
                                {
                                  $ifNull: [
                                    '$$z.minDistance',
                                    '$$z.min_distance',
                                  ],
                                },
                                0,
                              ],
                            },
                            maxDistance: {
                              $ifNull: [
                                {
                                  $ifNull: [
                                    '$$z.maxDistance',
                                    '$$z.max_distance',
                                  ],
                                },
                                0,
                              ],
                            },
                            price: { $ifNull: ['$$z.price', 0] },
                          },
                        },
                      },
                      averageRating: {
                        $ifNull: ['$$st0.averageRating', 0],
                      },
                      latitude: {
                        $ifNull: ['$$st0.latitude', null],
                      },
                      longitude: {
                        $ifNull: ['$$st0.longitude', null],
                      },
                      createdAt: '$$st0.createdAt',
                      updatedAt: '$$st0.updatedAt',
                    },
                  },
                },
                {
                  _id: null,
                  acceptsOrders: false,
                  supportsShipping: false,
                  id: '',
                  name: '',
                  bio: '',
                  email: '',
                  phoneNumber: '',
                  currency: 'CAD',
                  status: 'INACTIVE',
                  address: null,
                  owner: null,
                  likedBy: [],
                  createdAt: null,
                  updatedAt: null,
                  profileImage: '',
                  canCreateProducts: false,
                  shippingZones: [],
                  averageRating: 0,
                  latitude: null,
                  longitude: null,
                },
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            id: { $toString: '$_id' },
            title: 1,
            bio: 1,
            originCountry: { $ifNull: ['$originCountry', ''] },
            price: 1,
            discountPrice: { $ifNull: ['$discountPrice', 0] },
            currency: 1,
            profileImage: 1,
            galleryImages: 1,
            status: 1,
            likedBy: { $ifNull: ['$likedBy', []] },
            createdAt: 1,
            updatedAt: 1,
            extras: { $ifNull: ['$extras', []] },
            category: 1,
            store: 1,
            averageRating: { $ifNull: ['$averageRating', 0] },
            ordersCount: { $literal: 0 },
            inCart: { $literal: false },
            ratings: { $literal: [] },
          },
        },
      ];

      const pipeline: PipelineStage[] = [
        {
          $match: {
            likedBy: userId,
            status: ProductStatusEnum.ACTIVE,
          },
        },
        ...this.buildFavoriteProductsDailyMenuPreFilterStages(),
        {
          $facet: {
            meta: [{ $count: 'total' }],
            data: dataStages as any[],
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

      const agg = await this._productModel
        .aggregate(pipeline)
        .hint({ likedBy: 1, status: 1, updatedAt: -1 })
        .option({ allowDiskUse: true })
        .exec();

      const pack = agg[0] as {
        total?: number;
        data?: Record<string, unknown>[];
      };
      const total = typeof pack?.total === 'number' ? pack.total : 0;
      const rows = Array.isArray(pack?.data) ? pack.data : [];
      const data = this.stripHeavyFavoriteProductFields(rows);

      if (pagination) {
        return {
          data,
          total,
          page: pagination.page,
          limit: pagination.take,
        };
      }

      return data;
    });
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
