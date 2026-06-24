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

/** Unité du temps de cuisson estimé affiché au client. */
export enum EstimatedCookingTimeUnitEnum {
  SECOND = 's',
  MINUTE = 'm',
  HOUR = 'h',
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

@Schema({ _id: false })
export class ProductComplementOptionModel {
  @Prop({ required: true, name: 'label' })
  label: string;

  @Prop({ required: false, name: 'price_delta', default: 0 })
  priceDelta: number;

  @Prop({ required: false, name: 'is_default', default: false })
  isDefault: boolean;
}

export const ProductComplementOptionSchema = SchemaFactory.createForClass(
  ProductComplementOptionModel,
);

@Schema({ _id: false })
export class ProductComplementGroupModel {
  @Prop({ required: true, name: 'title' })
  title: string;

  @Prop({ required: false, name: 'first_option_free', default: false })
  firstOptionFree: boolean;

  @Prop({ required: false, name: 'multi_choice', default: false })
  multiChoice: boolean;

  /** Si true, le client doit choisir au moins une option (app mobile). Sinon « Aucun » possible. */
  @Prop({ required: false, name: 'required', default: false })
  required: boolean;

  @Prop({
    required: true,
    name: 'options',
    type: [ProductComplementOptionSchema],
    default: [],
  })
  options: ProductComplementOptionModel[];
}

export const ProductComplementGroupSchema = SchemaFactory.createForClass(
  ProductComplementGroupModel,
);

@Schema({ _id: false })
export class ProductSupplementModel {
  @Prop({ required: true, name: 'name' })
  name: string;

  @Prop({ required: false, name: 'price', default: 0 })
  price: number;
}

export const ProductSupplementSchema =
  SchemaFactory.createForClass(ProductSupplementModel);

/** Variante de prix (ex. Small / Medium / Large) — remplace prix & promo produit quand définies. */
@Schema({ _id: false })
export class ProductVariantModel {
  @Prop({ required: true, name: 'label' })
  label: string;

  @Prop({ required: true, name: 'price', default: 0 })
  price: number;

  @Prop({ required: false, name: 'discount_price', default: 0 })
  discountPrice?: number;

  @Prop({ required: false, name: 'is_default', default: false })
  isDefault: boolean;
}

export const ProductVariantSchema =
  SchemaFactory.createForClass(ProductVariantModel);

/** Fenêtre planifiée : prix catalogue + promo appliqués par le cron entre startAt et endAt. */
export class ProductDiscountScheduleModel {
  @Prop({ required: false, name: 'label' })
  label?: string;

  @Prop({ required: true, name: 'start_at' })
  startAt: Date;

  @Prop({ required: true, name: 'end_at' })
  endAt: Date;

  @Prop({ required: true, name: 'price', default: 0 })
  price: number;

  @Prop({ required: false, name: 'discount_price', default: 0 })
  discountPrice: number;
}

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

  @Prop({ type: [String], default: [], name: 'fieldsets' })
  fieldsets: string[];

  @Prop({ required: false, name: 'origin_country' })
  originCountry?: string;

  @Prop({ required: false, name: 'estimated_cooking_time' })
  estimatedCookingTime?: number;

  @Prop({
    required: false,
    name: 'estimated_cooking_time_unit',
    enum: Object.values(EstimatedCookingTimeUnitEnum),
  })
  estimatedCookingTimeUnit?: EstimatedCookingTimeUnitEnum;

  @Prop({ required: true, name: 'price', default: 0 })
  price: number;

  @Prop({ required: false, name: 'discount_price', default: 0 })
  discountPrice?: number;

  /** Prix affiché hors fenêtre promotionnelle active (baseline restaurée par le cron). */
  @Prop({ required: false, name: 'list_price' })
  listPrice?: number;

  @Prop({ required: false, name: 'list_discount_price', default: 0 })
  listDiscountPrice?: number;

  @Prop({
    default: [],
    name: 'discount_schedules',
    type: [ProductDiscountScheduleModel],
  })
  discountSchedules: ProductDiscountScheduleModel[];

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

  @Prop({
    default: [],
    name: 'complements',
    type: [ProductComplementGroupSchema],
  })
  complements: ProductComplementGroupModel[];

  @Prop({
    default: [],
    name: 'supplements',
    type: [ProductSupplementSchema],
  })
  supplements: ProductSupplementModel[];

  @Prop({
    default: [],
    name: 'variants',
    type: [ProductVariantSchema],
  })
  variants: ProductVariantModel[];

  /** Libellé du groupe de variantes affiché au client (ex. « Taille », « Format »). */
  @Prop({ required: false, default: '', name: 'variants_label' })
  variantsLabel?: string;
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
