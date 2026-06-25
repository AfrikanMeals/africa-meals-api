import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { productCategoriesCacheTtlMs } from '@common/redis-app-cache';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { InjectModel } from '@nestjs/mongoose';
import { ProductCategoryModel, ProductCategoryKindEnum } from '@schemas/product-category.schema';
import { DrinkModel } from '@schemas/drink.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { StoreStatusEnum } from '@schemas/store.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import { DEFAULT_CATEGORIES, DRINK_CATEGORY_ICONS, defaultCategoryIconForKind } from './data/categories';
import {
  CreateProductCategoryDto,
  PatchProductCategoryDto,
} from './dto/product-category.dto';
import { ProductCategoryImageJsonDto } from './dto/product-category-image.dto';
import { mapInChunks } from '@utils/map-in-chunks';
import { productDailyMenuListingPipelineStages } from '@utils/product-daily-menu-listing.pipeline';
import { MediasService } from '@modules/medias/medias.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';

/** Ligne JSON renvoyée par [filter] / REST / GraphQL public. */
export type PublicProductCategoryRow = {
  id: string;
  _id: string;
  title: string;
  icon: string;
  image?: string;
  kind: ProductCategoryKindEnum;
  isEnabled: boolean;
  productCount: number;
  createdAt: unknown;
  updatedAt: unknown;
};

@Injectable()
export class ProductCategoryService implements OnModuleInit {
  private readonly _logger = new Logger(ProductCategoryService.name);

  /** Cache liste publique catégories (invalidé à chaque mutation admin). */
  private static readonly _publicListCacheKey = 'product-categories:public:v5';

  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @InjectModel(DrinkModel.name)
  private readonly _drinkModel: Model<DrinkModel>;

  private static readonly _drinkCategoryIcons = [
    ...DRINK_CATEGORY_ICONS,
  ] as string[];

  async invalidatePublicListCache(): Promise<void> {
    await this._bustPublicCategoriesCache();
  }

  private _isDrinkCategory(raw: Record<string, unknown>): boolean {
    return this.resolveKind(raw) === ProductCategoryKindEnum.DRINK;
  }

  /** Plats « menu du jour » actifs pour une catégorie food (catalogue client). */
  private async _dailyMenuFoodCountLookupStages(): Promise<PipelineStage[]> {
    const regionTimezoneMap =
      await this._supportedCountries.getRegionTimezoneMap();
    return [
      {
        $match: {
          status: ProductStatusEnum.ACTIVE,
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
      {
        $match: {
          'store.status': StoreStatusEnum.ACTIVE,
          'store.acceptsOrders': true,
        },
      },
      ...productDailyMenuListingPipelineStages(regionTimezoneMap),
      { $group: { _id: null, n: { $sum: 1 } } },
    ];
  }

  private async _dailyMenuFoodCountForCategory(
    catId: unknown,
  ): Promise<number> {
    const lookupStages = await this._dailyMenuFoodCountLookupStages();
    const pipeline: PipelineStage[] = [
      {
        $match: {
          category: catId,
        },
      },
      ...lookupStages,
    ];
    const rows = await this._productModel
      .aggregate(pipeline)
      .option({ allowDiskUse: true })
      .exec();
    const row = rows[0] as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }

  private async _itemCountForCategory(
    cat: Record<string, unknown>,
  ): Promise<number> {
    const catId = cat._id;
    if (this._isDrinkCategory(cat)) {
      return this._drinkModel.countDocuments({ category: catId }).exec();
    }
    return this._dailyMenuFoodCountForCategory(catId);
  }

  private _categoriesListTtlMs() {
    return productCategoriesCacheTtlMs();
  }

  private async _bustPublicCategoriesCache() {
    await this._cacheLayer.bustKeyOnAllStores(
      ProductCategoryService._publicListCacheKey,
    );
  }

  private assertCanManageCategories(user: UserModel) {
    if (user.type !== UserTypeEnum.VENDOR && user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('forbidden');
    }
  }

  private resolveKind(
    raw: Record<string, unknown>,
  ): ProductCategoryKindEnum {
    const k = raw.kind ?? raw.category_kind;
    if (k === ProductCategoryKindEnum.DRINK || k === 'drink') {
      return ProductCategoryKindEnum.DRINK;
    }
    if (k === ProductCategoryKindEnum.FOOD || k === 'food') {
      return ProductCategoryKindEnum.FOOD;
    }
    const icon = String(raw.icon ?? '').trim();
    if (DRINK_CATEGORY_ICONS.has(icon)) {
      return ProductCategoryKindEnum.DRINK;
    }
    return ProductCategoryKindEnum.FOOD;
  }

  private mapLeanCategory(cat: Record<string, unknown>, productCount: number) {
    const imageRaw = cat.image ?? cat.category_image;
    const image =
      typeof imageRaw === 'string' && imageRaw.trim().length > 0
        ? imageRaw.trim()
        : undefined;
    return {
      id: cat._id,
      _id: cat._id,
      title: cat.title,
      icon: cat.icon,
      ...(image ? { image } : {}),
      kind: this.resolveKind(cat),
      isEnabled: (cat.is_enabled as boolean) ?? true,
      productCount,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
    };
  }

  async create(args: CreateProductCategoryDto, user: UserModel) {
    this.assertCanManageCategories(user);
    const title = args.title.trim();
    const dup = await this._productCategoryModel
      .findOne({
        title: new RegExp(
          `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
          'i',
        ),
      })
      .exec();
    if (dup) {
      throw new ConflictException('category_title_exists');
    }
    const kind = args.kind ?? ProductCategoryKindEnum.FOOD;
    const icon =
      args.icon?.trim() ||
      defaultCategoryIconForKind(kind);
    const doc = await this._productCategoryModel.create({
      title,
      icon,
      ...(args.image?.trim() ? { image: args.image.trim() } : {}),
      kind,
      isEnabled: args.isEnabled ?? true,
    });
    await this._bustPublicCategoriesCache();
    const lean = doc.toObject() as Record<string, unknown>;
    return this.mapLeanCategory(lean, 0);
  }

  async update(id: string, args: PatchProductCategoryDto, user: UserModel) {
    this.assertCanManageCategories(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('category_not_found');
    }
    const existing = await this._productCategoryModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('category_not_found');
    }
    if (args.title !== undefined) {
      const title = args.title.trim();
      const dup = await this._productCategoryModel
        .findOne({
          _id: { $ne: id },
          title: new RegExp(
            `^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
            'i',
          ),
        })
        .exec();
      if (dup) {
        throw new ConflictException('category_title_exists');
      }
      existing.title = title;
    }
    if (args.icon !== undefined) {
      existing.icon = args.icon.trim();
    }
    if (args.kind !== undefined) {
      existing.kind = args.kind;
    }
    if (args.isEnabled !== undefined) {
      existing.isEnabled = args.isEnabled;
    }
    if (args.image !== undefined) {
      const trimmed = args.image.trim();
      existing.image = trimmed.length > 0 ? trimmed : undefined;
    }
    await existing.save();
    await this._bustPublicCategoriesCache();
    const lean = existing.toObject() as Record<string, unknown>;
    const productCount = await this._itemCountForCategory(lean);
    return this.mapLeanCategory(lean, productCount);
  }

  async remove(id: string, user: UserModel) {
    this.assertCanManageCategories(user);
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('category_not_found');
    }
    const existing = await this._productCategoryModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('category_not_found');
    }
    const lean = existing.toObject() as Record<string, unknown>;
    const itemCount = await this._itemCountForCategory(lean);
    if (itemCount > 0) {
      throw new ConflictException('category_has_products');
    }
    await existing.deleteOne();
    await this._bustPublicCategoriesCache();
  }

  /**
   * Liste publique des catégories + compteur produits.
   * L’ancien `$lookup` chargeait **tous** les produits par catégorie en RAM → risque de timeout / 500 sur gros catalogues.
   */
  async filter(): Promise<PublicProductCategoryRow[]> {
    const categoriesCache = this._cacheLayer.cacheFor('productCategories');
    const cached = await categoriesCache.get<PublicProductCategoryRow[]>(
      ProductCategoryService._publicListCacheKey,
    );
    if (cached != null && cached.length > 0) {
      return cached;
    }

    try {
      const dailyMenuLookupStages = await this._dailyMenuFoodCountLookupStages();
      const pipeline: PipelineStage[] = [
        { $sort: { createdAt: 1 } },
        {
          $lookup: {
            from: 'products',
            let: { catId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$category', '$$catId'] },
                },
              },
              ...dailyMenuLookupStages,
            ] as any[],
            as: '_cnt',
          },
        },
        {
          $lookup: {
            from: 'drinks',
            let: { catId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$category', '$$catId'] },
                },
              },
              { $group: { _id: null, n: { $sum: 1 } } },
            ],
            as: '_drinkCnt',
          },
        },
        {
          $addFields: {
            _productN: {
              $let: {
                vars: { row: { $arrayElemAt: ['$_cnt', 0] } },
                in: { $ifNull: ['$$row.n', 0] },
              },
            },
            _drinkN: {
              $let: {
                vars: { row: { $arrayElemAt: ['$_drinkCnt', 0] } },
                in: { $ifNull: ['$$row.n', 0] },
              },
            },
          },
        },
        {
          $addFields: {
            productCount: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$kind', ProductCategoryKindEnum.DRINK] },
                    { $eq: ['$kind', 'drink'] },
                    {
                      $in: [
                        '$icon',
                        ProductCategoryService._drinkCategoryIcons,
                      ],
                    },
                  ],
                },
                '$_drinkN',
                '$_productN',
              ],
            },
          },
        },
        { $project: { _cnt: 0, _drinkCnt: 0 } },
      ];

      const raw = await this._productCategoryModel
        .aggregate(pipeline)
        .option({ allowDiskUse: true })
        .exec();

      const result = raw.map((doc: Record<string, unknown>) =>
        this.serializeCategoryRow(doc),
      );
      if (result.length > 0) {
        await categoriesCache.set(
          ProductCategoryService._publicListCacheKey,
          result,
          this._categoriesListTtlMs(),
        );
      }
      return result;
    } catch (e) {
      this._logger.warn(`filter aggregate fallback: ${(e as Error).message}`);
      try {
        const fallback = await this._filterWithCounts();
        if (fallback.length > 0) {
          await categoriesCache.set(
            ProductCategoryService._publicListCacheKey,
            fallback,
            this._categoriesListTtlMs(),
          );
        }
        return fallback;
      } catch (e2) {
        this._logger.error(
          `filter failed completely: ${(e2 as Error).message}`,
        );
        return [];
      }
    }
  }

  /** Objet JSON strict (ids string) pour éviter les soucis de sérialisation côté client. */
  private serializeCategoryRow(
    doc: Record<string, unknown>,
  ): PublicProductCategoryRow {
    const id = String(doc._id ?? '');
    const imageRaw = doc.image ?? doc.category_image;
    const image =
      typeof imageRaw === 'string' && imageRaw.trim().length > 0
        ? imageRaw.trim()
        : undefined;
    return {
      id,
      _id: id,
      title: String(doc.title ?? ''),
      icon: String(doc.icon ?? ''),
      ...(image ? { image } : {}),
      kind: this.resolveKind(doc),
      isEnabled: Boolean(doc.is_enabled ?? doc.isEnabled ?? true),
      productCount: Number(doc.productCount ?? 0),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private async _filterWithCounts() {
    const categories = await this._productCategoryModel
      .find()
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    /** Ne pas lancer un `countDocuments` par catégorie en parallèle (pic connexions Atlas). */
    return mapInChunks(categories, 3, async (cat: Record<string, unknown>) => {
      const productCount = await this._itemCountForCategory(cat);
      return this.serializeCategoryRow({
        ...cat,
        productCount,
      });
    });
  }

  async onModuleInit() {
    await this._seed();
  }

  private async _seed() {
    const existing = await this._productCategoryModel.find().exec();

    if (existing.length === 0) {
      await this._productCategoryModel.insertMany(DEFAULT_CATEGORIES);
      this._logger.log(
        `Seeded ${DEFAULT_CATEGORIES.length} default categories (empty collection)`,
      );
      return;
    }

    const kindByTitle = new Map(
      DEFAULT_CATEGORIES.map((d) => [d.title, d.kind] as const),
    );
    for (const cat of existing) {
      const expected =
        kindByTitle.get(cat.title) ??
        (DRINK_CATEGORY_ICONS.has(cat.icon)
          ? ProductCategoryKindEnum.DRINK
          : ProductCategoryKindEnum.FOOD);
      if (cat.kind !== expected) {
        cat.kind = expected;
        await cat.save();
      }
    }
  }

  /** Illustration catalogue → moteur Paramètres → Stockage (`catalog/categories`). */
  async uploadCategoryImage(
    user: UserModel,
    dto: ProductCategoryImageJsonDto,
  ): Promise<{ url: string }> {
    this.assertCanManageCategories(user);
    const raw = dto.imageBase64
      .replace(/\s/g, '')
      .replace(/^data:image\/[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_image');
    }
    const max = await this._mediasService.getMaxFileSizeBytes();
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name =
      (dto.filename || 'category.jpg').trim() || 'category.jpg';
    if (!/\.(jpe?g|png|webp)$/i.test(name)) {
      throw new BadRequestException('invalid_file_type');
    }
    const lower = name.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    const file = {
      buffer,
      originalname: name,
      mimetype: mime,
      size: buffer.length,
    } as Express.Multer.File;
    const url = await this._mediasService.upload(
      file,
      user,
      'catalog/categories',
    );
    const resolved =
      (await this._mediasService.resolvePublicMediaUrl(url)) ?? url;
    return { url: resolved };
  }
}
