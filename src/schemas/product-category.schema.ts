import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

@Schema({
  timestamps: true,
  collection: 'product_catagories',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class ProductCategoryModel extends BaseSchema {
  @Prop({ required: true, name: 'title' })
  title: string;

  @Prop({ required: true, name: 'icon' })
  icon: string;

  @Prop({ default: true, name: 'is_enabled' })
  isEnabled: boolean;
}

export const ProductCategorySchema =
  SchemaFactory.createForClass(ProductCategoryModel);

export type ProductCategoryModelDocument = ProductCategoryModel & Document;
