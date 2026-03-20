import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel } from '@schemas/product.schema';
import { Model } from 'mongoose';
import { DEFAULT_CATEGORIES } from './data/categories';

@Injectable()
export class ProductCategoryService implements OnModuleInit {
  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

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
