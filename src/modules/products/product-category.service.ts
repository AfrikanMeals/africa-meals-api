import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import { Cache } from 'cache-manager';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel } from '@schemas/product.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, PipelineStage, Types } from 'mongoose';
import { DEFAULT_CATEGORIES } from './data/categories';
import {
  CreateProductCategoryDto,
  PatchProductCategoryDto,
} from './dto/product-category.dto';

/** Ligne JSON renvoyée par [filter] / REST / GraphQL public. */
export type PublicProductCategoryRow = {
  id: string;
  _id: string;
  title: string;
  icon: string;
  isEnabled: boolean;
  productCount: number;
  createdAt: unknown;
  updatedAt: unknown;
};

@Injectable()
export class ProductCategoryService implements OnModuleInit {
  private readonly _logger = new Logger(ProductCategoryService.name);

  /** Cache liste publique catégories (invalidé à chaque mutation admin). */
  private static readonly _publicListCacheKey = 'product-categories:public:v1';

  @Inject(CACHE_MANAGER)
  private readonly _cache: Cache;

  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  private _categoriesListTtlMs() {
    const n = Number(process.env.PRODUCT_CATEGORIES_CACHE_TTL_MS);
    return Number.isFinite(n) && n > 0 ? n : 120_000;
  }

  private async _bustPublicCategoriesCache() {
    await this._cache.del(ProductCategoryService._publicListCacheKey);
  }

  private assertCanManageCategories(user: UserModel) {
    if (
      user.type !== UserTypeEnum.VENDOR &&
      user.type !== UserTypeEnum.ADMIN
    ) {
      throw new ForbiddenException('forbidden');
    }
  }

  private mapLeanCategory(
    cat: Record<string, unknown>,
    productCount: number,
  ) {
    return {
      id: cat._id,
      _id: cat._id,
      title: cat.title,
      icon: cat.icon,
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
      .findOne({ title: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') })
      .exec();
    if (dup) {
      throw new ConflictException('category_title_exists');
    }
    const doc = await this._productCategoryModel.create({
      title,
      icon: args.icon.trim(),
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
    if (args.isEnabled !== undefined) {
      existing.isEnabled = args.isEnabled;
    }
    await existing.save();
    await this._bustPublicCategoriesCache();
    const productCount = await this._productModel
      .countDocuments({ category: existing._id })
      .exec();
    const lean = existing.toObject() as Record<string, unknown>;
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
    const productCount = await this._productModel
      .countDocuments({ category: existing._id })
      .exec();
    if (productCount > 0) {
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
    const cached = await this._cache.get<PublicProductCategoryRow[]>(
      ProductCategoryService._publicListCacheKey,
    );
    if (cached != null && cached.length > 0) {
      return cached;
    }

    try {
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
              { $group: { _id: null, n: { $sum: 1 } } },
            ],
            as: '_cnt',
          },
        },
        {
          $addFields: {
            productCount: {
              $let: {
                vars: { row: { $arrayElemAt: ['$_cnt', 0] } },
                in: { $ifNull: ['$$row.n', 0] },
              },
            },
          },
        },
        { $project: { _cnt: 0 } },
      ];

      const raw = await this._productCategoryModel.aggregate(pipeline).exec();

      const result = raw.map((doc: Record<string, unknown>) =>
        this.serializeCategoryRow(doc),
      );
      if (result.length > 0) {
        await this._cache.set(
          ProductCategoryService._publicListCacheKey,
          result,
          this._categoriesListTtlMs(),
        );
      }
      return result;
    } catch (e) {
      this._logger.warn(
        `filter aggregate fallback: ${(e as Error).message}`,
      );
      try {
        const fallback = await this._filterWithCounts();
        if (fallback.length > 0) {
          await this._cache.set(
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
  private serializeCategoryRow(doc: Record<string, unknown>): PublicProductCategoryRow {
    const id = String(doc._id ?? '');
    return {
      id,
      _id: id,
      title: String(doc.title ?? ''),
      icon: String(doc.icon ?? ''),
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
    const result = await Promise.all(
      categories.map(async (cat: Record<string, unknown>) => {
        const productCount = await this._productModel
          .countDocuments({ category: cat._id })
          .exec();
        return this.serializeCategoryRow({
          ...cat,
          productCount,
        });
      }),
    );
    return result;
  }

  async onModuleInit() {
    await this._seed();
  }

  private async _seed() {
    const data = DEFAULT_CATEGORIES;
    const existing = await this._productCategoryModel.find().exec();
    const toCreate = data.filter(
      (d) => !existing.find((e) => e.title === d.title),
    );

    if (toCreate.length) {
      await this._productCategoryModel.insertMany(toCreate);
      console.log(`🚀 ~ Seeded ${toCreate.length} categories`);
    }
  }
}
