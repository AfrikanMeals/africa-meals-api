import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { OrderModel } from './order.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

export enum DeliveryOrderOfferStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
}

@Schema({
  timestamps: true,
  collection: 'delivery_order_offers',
  toJSON: { virtuals: true, getters: true },
})
export class DeliveryOrderOfferModel extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: OrderModel.name,
    required: true,
    index: true,
  })
  orderId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  storeId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    index: true,
  })
  agentUserId: MongooseSchema.Types.ObjectId;

  /** Rang 0-based dans la file classée au démarrage de la cascade. */
  @Prop({ required: true, min: 0 })
  rank: number;

  @Prop({
    enum: DeliveryOrderOfferStatus,
    default: DeliveryOrderOfferStatus.PENDING,
    index: true,
  })
  status: DeliveryOrderOfferStatus;

  @Prop({ required: false, name: 'distance_meters' })
  distanceMeters?: number;

  @Prop({ required: true, name: 'offered_at', default: () => new Date() })
  offeredAt: Date;

  @Prop({ required: true, name: 'expires_at', index: true })
  expiresAt: Date;

  @Prop({ required: false, name: 'responded_at' })
  respondedAt?: Date;
}

export type DeliveryOrderOfferDocument = DeliveryOrderOfferModel & Document;

export const DeliveryOrderOfferSchema = SchemaFactory.createForClass(
  DeliveryOrderOfferModel,
);

/** Une seule offre `pending` par commande. */
DeliveryOrderOfferSchema.index(
  { orderId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: DeliveryOrderOfferStatus.PENDING },
  },
);

DeliveryOrderOfferSchema.index({ agentUserId: 1, status: 1 });
DeliveryOrderOfferSchema.index({ expiresAt: 1, status: 1 });
