import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';

/** Cycle de vie d'une livraison « client absent » avec preuve photo. */
export enum PendingDeliveryProofStatusEnum {
  /** Soumis par le livreur — en attente confirmation client. */
  SUBMITTED = 'submitted',
  /** Client a confirmé réception — en attente validation admin. */
  CUSTOMER_CONFIRMED = 'customer_confirmed',
  /** Client conteste la livraison. */
  CUSTOMER_DISPUTED = 'customer_disputed',
  /** Admin a validé — commande complétée. */
  ADMIN_APPROVED = 'admin_approved',
  /** Admin a rejeté la preuve. */
  ADMIN_REJECTED = 'admin_rejected',
}

@Schema({
  timestamps: true,
  collection: 'pending_delivery_proofs',
  toJSON: { getters: true, virtuals: true },
})
export class PendingDeliveryProofModel extends BaseSchema {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'OrderModel',
    required: true,
    name: 'order_id',
    index: true,
    unique: true,
  })
  orderId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: true,
    name: 'delivery_agent_id',
    index: true,
  })
  deliveryAgentId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'StoreModel',
    required: true,
    name: 'store_id',
    index: true,
  })
  storeId: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: true,
    name: 'customer_user_id',
    index: true,
  })
  customerUserId: MongooseSchema.Types.ObjectId;

  @Prop({
    required: true,
    enum: PendingDeliveryProofStatusEnum,
    default: PendingDeliveryProofStatusEnum.SUBMITTED,
  })
  status: PendingDeliveryProofStatusEnum;

  @Prop({ required: true, name: 'delivery_address_lat' })
  deliveryAddressLat: number;

  @Prop({ required: true, name: 'delivery_address_lng' })
  deliveryAddressLng: number;

  @Prop({ required: true, name: 'courier_lat' })
  courierLat: number;

  @Prop({ required: true, name: 'courier_lng' })
  courierLng: number;

  /** Distance haversine livreur → adresse (mètres). */
  @Prop({ required: true, name: 'distance_meters' })
  distanceMeters: number;

  @Prop({ type: [String], default: [], name: 'proof_photo_urls' })
  proofPhotoUrls: string[];

  @Prop({ required: false, name: 'shipping_address_line', trim: true })
  shippingAddressLine?: string;

  @Prop({ required: false, name: 'order_ref', trim: true })
  orderRef?: string;

  @Prop({ required: false, name: 'customer_confirmed_at', type: Date })
  customerConfirmedAt?: Date;

  @Prop({ required: false, name: 'customer_confirm_note', trim: true, maxlength: 2000 })
  customerConfirmNote?: string;

  @Prop({ required: false, name: 'customer_disputed_at', type: Date })
  customerDisputedAt?: Date;

  @Prop({ required: false, name: 'customer_dispute_note', trim: true, maxlength: 2000 })
  customerDisputeNote?: string;

  @Prop({ required: false, name: 'admin_reviewed_at', type: Date })
  adminReviewedAt?: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: false,
    name: 'admin_reviewed_by',
  })
  adminReviewedBy?: MongooseSchema.Types.ObjectId;

  @Prop({ required: false, name: 'admin_note', trim: true, maxlength: 2000 })
  adminNote?: string;
}

export const PendingDeliveryProofSchema = SchemaFactory.createForClass(
  PendingDeliveryProofModel,
);

PendingDeliveryProofSchema.index({ status: 1, createdAt: -1 });
