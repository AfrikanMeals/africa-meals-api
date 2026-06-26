import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Document } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';

export enum StoreCouponDiscountTypeEnum {
  FIXED = 'FIXED',
  PERCENTAGE = 'PERCENTAGE',
}

@Schema({
  timestamps: true,
  collection: 'store_coupons',
  toJSON: { virtuals: true },
})
export class StoreCouponModel extends BaseSchema {
  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
  })
  store: MongooseSchema.Types.ObjectId;

  @Prop({
    required: true,
    enum: StoreCouponDiscountTypeEnum,
  })
  discountType: StoreCouponDiscountTypeEnum;

  /** Montant devise (FIXED) ou pourcentage 1–100 (PERCENTAGE). */
  @Prop({ required: true })
  value: number;

  @Prop({ required: true })
  validFrom: Date;

  @Prop({ required: true })
  validUntil: Date;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ default: 0 })
  usedCount: number;

  @Prop({ required: false })
  maxUses?: number;

  /** Si true : chaque utilisateur ne peut utiliser ce coupon qu’une seule fois. */
  @Prop({ default: false, name: 'limit_one_use_per_user' })
  limitOneUsePerUser?: boolean;

  /** Suivi des utilisations par userId (quota 1× / client). */
  @Prop({
    type: [
      {
        _id: false,
        userId: { type: MongooseSchema.Types.ObjectId, required: true },
        count: { type: Number, required: true, default: 0 },
      },
    ],
    default: [],
    name: 'user_usages',
  })
  userUsages: { userId: MongooseSchema.Types.ObjectId; count: number }[];
}

export const StoreCouponSchema = SchemaFactory.createForClass(StoreCouponModel);

StoreCouponSchema.index({ store: 1, code: 1 }, { unique: true });

StoreCouponSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export type StoreCouponModelDocument = StoreCouponModel & Document;
