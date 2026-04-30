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

  /** Image stockée en base (base64) — alternative au fichier distant `profile_image`. */
  @Prop({ required: false, name: 'image_mime_type' })
  imageMimeType?: string;

  @Prop({ required: false, name: 'image_base64' })
  imageBase64?: string;

  /** Jusqu’à 2 images supplémentaires (en plus de l’image principale). Base64 (legacy) ou URL Firebase. */
  @Prop({
    type: [
      {
        imageMimeType: { type: String, required: false },
        imageBase64: { type: String, required: false },
        imageUrl: { type: String, required: false },
      },
    ],
    default: [],
  })
  galleryImages?: Array<{
    imageMimeType?: string;
    imageBase64?: string;
    imageUrl?: string;
  }>;

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

/** Liste « mes favoris » : filtre fréquent likedBy + status + tri. */
ProductSchema.index({ likedBy: 1, status: 1, updatedAt: -1 });

/** Recherche catalogue : jointure store + filtre actif + tri récent. */
ProductSchema.index({ store: 1, status: 1, createdAt: -1 });
ProductSchema.index({ category: 1, status: 1, createdAt: -1 });

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
