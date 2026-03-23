import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel } from '@schemas/product.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { DEFAULT_CATEGORIES } from './data/categories';
import {
  CreateProductCategoryDto,
  PatchProductCategoryDto,
} from './dto/product-category.dto';

@Injectable()
export class ProductCategoryService implements OnModuleInit {
  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

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
  }

  async filter() {
    try {
      const raw = await this._productCategoryModel
        .aggregate([
          { $sort: { createdAt: 1 } },
          {
            $lookup: {
              from: 'products',
              localField: '_id',
              foreignField: 'category',
              as: '_products',
            },
          },
          {
            $addFields: {
              productCount: { $size: '$_products' },
            },
          },
          { $project: { _products: 0 } },
        ])
        .exec();

      return raw.map((doc: Record<string, unknown>) => ({
        id: doc._id,
        _id: doc._id,
        title: doc.title,
        icon: doc.icon,
        isEnabled: doc.is_enabled ?? true,
        productCount: doc.productCount ?? 0,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }));
    } catch {
      return this._filterWithCounts();
    }
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
