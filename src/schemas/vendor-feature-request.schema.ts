import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

export enum VendorFeatureRequestStatusEnum {
  PENDING = 'PENDING',
  REVIEWING = 'REVIEWING',
  PLANNED = 'PLANNED',
  REJECTED = 'REJECTED',
  DONE = 'DONE',
  APPROVED = 'APPROVED',
  DEPLOYED = 'DEPLOYED',
}

export enum VendorFeatureRequestCategoryEnum {
  FEATURE = 'FEATURE',
  IMPROVEMENT = 'IMPROVEMENT',
  INTEGRATION = 'INTEGRATION',
  OTHER = 'OTHER',
}

@Schema({
  timestamps: true,
  collection: 'vendor_feature_requests',
})
export class VendorFeatureRequestModel extends BaseSchema {
  @Prop({
    required: true,
    name: 'user',
    ref: UserModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  user: UserModel;

  @Prop({
    required: false,
    name: 'store',
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  store?: StoreModel;

  @Prop({ required: true, trim: true, maxlength: 120 })
  title: string;

  @Prop({ required: true, trim: true, maxlength: 4000 })
  description: string;

  @Prop({
    required: true,
    enum: VendorFeatureRequestCategoryEnum,
    default: VendorFeatureRequestCategoryEnum.FEATURE,
  })
  category: VendorFeatureRequestCategoryEnum;

  @Prop({
    required: true,
    enum: VendorFeatureRequestStatusEnum,
    default: VendorFeatureRequestStatusEnum.PENDING,
  })
  status: VendorFeatureRequestStatusEnum;
}

export const VendorFeatureRequestSchema = SchemaFactory.createForClass(
  VendorFeatureRequestModel,
);

VendorFeatureRequestSchema.index({ user: 1, createdAt: -1 });
VendorFeatureRequestSchema.index({ status: 1, createdAt: -1 });

export type VendorFeatureRequestModelDocument = VendorFeatureRequestModel &
  Document;
