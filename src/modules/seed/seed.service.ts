import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { AddressModel } from '@schemas/address.schema';
import { ProductCategoryModel } from '@schemas/product-category.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { UserTypeEnum } from '@schemas/user.schema';
import { DEFAULT_CATEGORIES } from '@modules/products/data/categories';
import {
  getMockAddresses,
  getMockProductsForStore,
  getMockStores,
  getMockUsers,
} from './seed.data';

const NUM_STORES = 10;
const NUM_PRODUCTS_PER_STORE = 20;

@Injectable()
export class SeedService implements OnModuleInit {
  @InjectModel(UserModel.name)
  private readonly userModel: Model<UserModel>;

  @InjectModel(AddressModel.name)
  private readonly addressModel: Model<AddressModel>;

  @InjectModel(StoreModel.name)
  private readonly storeModel: Model<StoreModel>;

  @InjectModel(ProductModel.name)
  private readonly productModel: Model<ProductModel>;

  @InjectModel(ProductCategoryModel.name)
  private readonly categoryModel: Model<ProductCategoryModel>;

  async onModuleInit() {
    await this.seedStoresAndProducts();
  }

  async seedStoresAndProducts() {
    const storeCount = await this.storeModel.countDocuments().exec();
    if (storeCount >= NUM_STORES) {
      return;
    }

    await this.ensureCategories();

    const categories = await this.categoryModel.find().limit(1).exec();
    const categoryId = categories[0]?._id;
    if (!categoryId) {
      console.warn('Seed: No product category found, skipping product seed.');
    }

    const mockUsers = getMockUsers();
    const hashedPassword = await bcrypt.hash(mockUsers[0].password, 10);
    const users = await this.userModel.insertMany(
      mockUsers.map((u) => ({
        ...u,
        password: hashedPassword,
      })),
    );

    const mockAddresses = getMockAddresses();
    const addresses = await this.addressModel.insertMany(mockAddresses);

    const mockStores = getMockStores();
    const stores = await this.storeModel.insertMany(
      mockStores.map((s, i) => ({
        ...s,
        address: addresses[i]._id,
        owner: users[i]._id,
      })),
    );

    for (let i = 0; i < users.length; i++) {
      await this.userModel
        .updateOne(
          { _id: users[i]._id },
          {
            $push: { stores: stores[i]._id },
            $set: { type: UserTypeEnum.VENDOR },
          },
        )
        .exec();
    }

    if (categoryId) {
      const productDocs: Array<Record<string, unknown>> = [];
      for (let s = 0; s < stores.length; s++) {
        const mockProducts = getMockProductsForStore(NUM_PRODUCTS_PER_STORE);
        for (const p of mockProducts) {
          productDocs.push({
            ...p,
            category: categoryId,
            store: stores[s]._id,
          });
        }
      }
      await this.productModel.insertMany(productDocs);
    }

    console.log(
      `Seed: Created ${stores.length} stores and ${stores.length * NUM_PRODUCTS_PER_STORE} products.`,
    );
  }

  private async ensureCategories() {
    const existing = await this.categoryModel.find().exec();
    const toCreate = DEFAULT_CATEGORIES.filter(
      (d) => !existing.some((e) => e.title === d.title),
    );
    if (toCreate.length) {
      await this.categoryModel.insertMany(toCreate);
      console.log(`Seed: Created ${toCreate.length} product categories.`);
    }
  }
}
