import { BaseSchema } from '@schemas/base.schema';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum AdCreditPaymentStatusEnum {
  PAID = 'PAID',
}

@Schema({ collection: 'ad-credit-payments', timestamps: true })
export class AdCreditPaymentModel extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: true, index: true })
  owner: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amountPaidCad: number;

  @Prop({ required: true, default: 'CAD' })
  currency: string;

  @Prop({ required: true, enum: AdCreditPaymentStatusEnum, default: AdCreditPaymentStatusEnum.PAID })
  status: AdCreditPaymentStatusEnum;

  @Prop({ required: true, unique: true, index: true })
  stripeCheckoutSessionId: string;

  @Prop({ required: false, default: null })
  stripePaymentIntentId?: string | null;

  @Prop({ required: true, default: () => new Date() })
  paidAt: Date;
}

export const AdCreditPaymentSchema =
  SchemaFactory.createForClass(AdCreditPaymentModel);
