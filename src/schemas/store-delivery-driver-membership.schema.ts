import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

export enum StoreDeliveryDriverMembershipStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  DECLINED = 'DECLINED',
  REVOKED = 'REVOKED',
}

@Schema({
  timestamps: true,
  collection: 'store_delivery_driver_memberships',
  toJSON: { virtuals: true, getters: true },
})
export class StoreDeliveryDriverMembershipModel extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  store: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: false,
    index: true,
  })
  user?: MongooseSchema.Types.ObjectId;

  @Prop({
    enum: StoreDeliveryDriverMembershipStatus,
    default: StoreDeliveryDriverMembershipStatus.PENDING,
    index: true,
  })
  status: StoreDeliveryDriverMembershipStatus;

  @Prop({ required: false, index: true, sparse: true, name: 'invite_token' })
  inviteToken?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    name: 'invited_by',
  })
  invitedBy: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, name: 'invited_at', default: () => new Date() })
  invitedAt: Date;

  @Prop({ required: false, name: 'responded_at' })
  respondedAt?: Date;
}

export const StoreDeliveryDriverMembershipSchema = SchemaFactory.createForClass(
  StoreDeliveryDriverMembershipModel,
);

StoreDeliveryDriverMembershipSchema.index(
  { store: 1, email: 1 },
  { unique: true },
);

StoreDeliveryDriverMembershipSchema.index(
  { store: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: { user: { $type: 'objectId' } },
  },
);

export type StoreDeliveryDriverMembershipDocument =
  StoreDeliveryDriverMembershipModel & Document;
