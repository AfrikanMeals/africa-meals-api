import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { ProductCategoryModel } from './product-category.schema';
import { ProductRatingModel } from './product_rating.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

export enum ProductStatusEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Schema({
  timestamps: true,
  collection: 'product_extras',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class ProductExtraModel extends BaseSchema {
  @Prop({ required: true, name: 'title' })
  title: string;

  @Prop({ required: true, name: 'description' })
  description: string;

  @Prop({ required: true, name: 'price' })
  price: number;

  @Prop({ required: false, name: 'profile_image' })
  profileImage?: string;

  // TODO add statisc properties(purchass count, ...)
}

export const ProductExtraSchema =
  SchemaFactory.createForClass(ProductExtraModel);

export type ProductExtraModelDocument = ProductExtraModel & Document;

@Schema({
  timestamps: true,
  collection: 'products',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class ProductModel extends BaseSchema {
  @Prop({ required: true, name: 'title' })
  title: string;

  @Prop({ required: true, name: 'bio' })
  bio: string;

  @Prop({ required: false, name: 'about' }) // Should we use AI to generate this based on the title?
  about?: string;

  @Prop({ required: false, name: 'origin_country' })
  originCountry?: string;

  @Prop({ required: true, name: 'price', default: 0 })
  price: number;

  @Prop({ required: false, name: 'discount_price', default: 0 })
  discountPrice?: number;

  @Prop({ required: true, name: 'currency', default: 'CAD' })
  currency: string;

  @Prop({ required: false, name: 'profile_image' })
  profileImage?: string;

  @Prop({
    required: true,
    name: 'status',
    enum: ProductStatusEnum,
    default: ProductStatusEnum.PENDING,
  })
  status: ProductStatusEnum;

  @Prop({
    name: 'ratings',
    ref: 'ProductRatingModel',
    type: [MongooseSchema.Types.ObjectId],
    select: false,
    default: [],
  })
  ratings: ProductRatingModel[];

  @Prop({
    required: true,
    name: 'category',
    ref: 'ProductCategoryModel',
    type: MongooseSchema.Types.ObjectId,
  })
  category: ProductCategoryModel;

  @Prop({
    required: true,
    name: 'store',
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  store: StoreModel;

  @Prop({
    default: [],
    name: 'owner',
    ref: 'UserModel',
    type: [MongooseSchema.Types.ObjectId],
  })
  likedBy: UserModel[];

  @Prop({
    default: [],
    name: 'extras',
    type: [ProductExtraModel],
  })
  extras: ProductExtraModel[];
}

export const ProductSchema = SchemaFactory.createForClass(ProductModel);

ProductSchema.virtual('averageRating').get(function () {
  const items = this.ratings || [];
  if (!items.length) {
    return 0;
  }
  return (
    items.reduce((a: number, b: ProductRatingModel) => a + b.rate, 0) /
    items.length
  );
});

ProductSchema.virtual('ordersCount').get(function () {
  return 0;
});

export type ProductModelDocument = ProductModel & Document;
