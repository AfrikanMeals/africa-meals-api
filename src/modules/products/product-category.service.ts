import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { Model } from 'mongoose';
import { DEFAULT_CATEGORIES } from './data/categories';

@Injectable()
export class ProductCategoryService implements OnModuleInit {
  @InjectModel(ProductCategoryModel.name)
  private readonly _productCategoryModel: Model<ProductCategoryModel>;

  async filter() {
    return this._productCategoryModel.find().exec();
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
