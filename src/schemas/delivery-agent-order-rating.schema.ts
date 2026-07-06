import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import type { OrderModel } from './order.schema';
import type { UserModel } from './user.schema';

/** Avis client sur le livreur après livraison d'une commande. */
@Schema({
  timestamps: true,
  collection: 'delivery_agent_order_ratings',
})
export class DeliveryAgentOrderRatingModel extends BaseSchema {
  @Prop({ required: true, min: 1, max: 5 })
  rate: number;

  /** 1 = mauvais, 2 = correct, 3 = excellent */
  @Prop({ required: true, min: 1, max: 3 })
  experience: number;

  @Prop({ required: false, maxlength: 500, trim: true })
  comment?: string;

  @Prop({
    required: true,
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
  })
  user: UserModel;

  @Prop({
    required: true,
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
  })
  deliveryAgent: UserModel;

  @Prop({
    required: true,
    ref: 'OrderModel',
    type: MongooseSchema.Types.ObjectId,
  })
  order: OrderModel;
}

export const DeliveryAgentOrderRatingSchema = SchemaFactory.createForClass(
  DeliveryAgentOrderRatingModel,
);

DeliveryAgentOrderRatingSchema.index({ order: 1, user: 1 }, { unique: true });
DeliveryAgentOrderRatingSchema.index({ deliveryAgent: 1, createdAt: -1 });

export type DeliveryAgentOrderRatingModelDocument =
  DeliveryAgentOrderRatingModel & Document;
