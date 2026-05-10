import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { OfferModel } from './offer.schema';
import { ProductExtraModel, ProductModel } from './product.schema';
import { StoreModel } from './store.schema';

export enum CartItemTypeEnum {
  PRODUCT = 'product',
  PRODUCT_EXTRA = 'product_extra',
  OFFER = 'offer',
  DRINK = 'drink',
}

@Schema({
  timestamps: true,
  collection: 'cart_items',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class CartItemModel extends BaseSchema {
  @Prop({
    required: true,
    name: 'store',
    type: MongooseSchema.Types.ObjectId,
    ref: 'StoreModel',
  })
  store: StoreModel;

  @Prop({
    required: true,
    name: 'type',
    enum: CartItemTypeEnum,
  })
  type: CartItemTypeEnum;

  @Prop({ required: false, name: 'product_id' })
  productId: string;

  @Prop({ required: true, name: 'entity_id' })
  entityId: string;

  @Prop({ required: true, name: 'quantity', default: 1 })
  quantity: number;

  @Prop({ required: true, name: 'price' })
  price: number;

  @Prop({
    required: true,
    name: 'user',
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  user: string;

  // Computed properties (boisson panier : objet minimal type « produit » pour le client)
  entity?: ProductModel | ProductExtraModel | OfferModel | Record<string, unknown>;
}

export const CartItemSchema = SchemaFactory.createForClass(CartItemModel);

export type CartModelDocument = CartItemModel & Document;
