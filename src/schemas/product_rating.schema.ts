import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { ProductModel } from './product.schema';
import { UserModel } from './user.schema';

@Schema({
  timestamps: true,
  collection: 'product_ratings',
})
export class ProductRatingModel extends BaseSchema {
  @Prop({ required: true, name: 'rate', min: 1, max: 5 })
  rate: number;

  @Prop({ required: false, name: 'comment' })
  comment?: string;

  @Prop({
    required: true,
    name: 'user',
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
  })
  user: UserModel;

  @Prop({
    required: true,
    name: 'product',
    ref: 'ProductModel',
    type: MongooseSchema.Types.ObjectId,
  })
  product: ProductModel;
}

export const ProductRatingSchema =
  SchemaFactory.createForClass(ProductRatingModel);

/** Agrégations recherche / menu : `$lookup` filtré par plat. */
ProductRatingSchema.index({ product: 1 });

export type ProductRatingModelDocument = ProductRatingModel & Document;
