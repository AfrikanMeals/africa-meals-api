import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

export enum PaymentMetodProviderEnum {
  STRIPE = 'STRIPE',
  PAYPAL = 'PAYPAL',
  PAYPAL_CARD = 'PAYPAL_CARD',
}

@Schema({
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
class PaymentMethodCardModel {
  @Prop({ required: true, name: 'last4' })
  last4: string;

  @Prop({ required: true, name: 'expiry' })
  expiry: string;

  @Prop({ required: true, name: 'brand' })
  brand: string;

  @Prop({ required: true, name: 'name' })
  name: string;
}

@Schema({
  timestamps: true,
  collection: 'payment_methods',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class PaymentMethodModel extends BaseSchema {
  @Prop({ default: false, name: 'is_default' })
  isDefault: boolean;

  @Prop({ required: true, name: 'provider_id' })
  providerId: string;

  @Prop({ required: false, name: 'provider_customer_id' })
  prodiderCustomerId: string;

  @Prop({ required: false, name: 'provider_user_name' })
  prodiderUserName: string;

  @Prop({
    required: true,
    name: 'provider',
    enum: PaymentMetodProviderEnum,
    default: PaymentMetodProviderEnum.PAYPAL,
  })
  provider: PaymentMetodProviderEnum;

  @Prop({
    required: false,
    name: 'card',
    enum: PaymentMethodCardModel,
  })
  card?: PaymentMethodCardModel;

  @Prop({
    required: true,
    name: 'user',
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
  })
  user: UserModel;
}

export const PaymentMethodSchema =
  SchemaFactory.createForClass(PaymentMethodModel);

export type PaymentMethodModelDocument = PaymentMethodModel & Document;
