import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { OrderStatusEnum } from './order.schema';

/** Origine du changement de statut (audit). */
export enum OrderStatusChangeSourceEnum {
  CHECKOUT = 'checkout',
  STRIPE = 'stripe',
  DASHBOARD = 'dashboard',
  SYSTEM = 'system',
  VENDOR = 'vendor',
  DELIVERY_AGENT = 'delivery_agent',
}

@Schema({
  collection: 'order_status_events',
  timestamps: true,
})
export class OrderStatusEventModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'OrderModel',
    required: true,
    index: true,
  })
  order: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'StoreModel',
    required: false,
    index: true,
  })
  store?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: false,
    index: true,
  })
  customerUser?: MongooseSchema.Types.ObjectId;

  @Prop({
    required: false,
    enum: Object.values(OrderStatusEnum),
  })
  fromStatus?: OrderStatusEnum;

  @Prop({
    required: true,
    enum: Object.values(OrderStatusEnum),
  })
  toStatus: OrderStatusEnum;

  @Prop({
    required: true,
    enum: Object.values(OrderStatusChangeSourceEnum),
    default: OrderStatusChangeSourceEnum.SYSTEM,
  })
  source: OrderStatusChangeSourceEnum;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: false,
  })
  actorUserId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: false, trim: true, maxlength: 500 })
  note?: string;
}

export type OrderStatusEventDocument = OrderStatusEventModel & Document;

export const OrderStatusEventSchema = SchemaFactory.createForClass(
  OrderStatusEventModel,
);

OrderStatusEventSchema.index({ createdAt: -1 });
OrderStatusEventSchema.index({ order: 1, createdAt: -1 });
