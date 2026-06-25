import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

export enum ProductCategoryKindEnum {
  FOOD = 'food',
  DRINK = 'drink',
}

@Schema({
  timestamps: true,
  collection: 'product_categories',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class ProductCategoryModel extends BaseSchema {
  @Prop({ required: true, name: 'title' })
  title: string;

  @Prop({ name: 'icon', default: 'meals' })
  icon?: string;

  /** Illustration catalogue (URL MinIO / proxy API). */
  @Prop({ name: 'image' })
  image?: string;

  @Prop({ default: true, name: 'is_enabled' })
  isEnabled: boolean;

  /** Repas / plats vs boissons (affichage catalogue). */
  @Prop({
    type: String,
    enum: Object.values(ProductCategoryKindEnum),
    default: ProductCategoryKindEnum.FOOD,
    name: 'kind',
  })
  kind: ProductCategoryKindEnum;
}

export const ProductCategorySchema =
  SchemaFactory.createForClass(ProductCategoryModel);

export type ProductCategoryModelDocument = ProductCategoryModel & Document;
