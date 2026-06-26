import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { OrderStatusEnum } from './order.schema';

/** Copie d’une commande ouverte archivée avant réinitialisation Stripe Connect admin. */
@Schema({ timestamps: true, collection: 'vendor_stripe_reset_order_archives' })
export class VendorStripeResetOrderArchiveModel {
  @Prop({ type: String, required: true, index: true })
  resetBatchId: string;

  @Prop({ type: Types.ObjectId, ref: 'StoreModel', required: true, index: true })
  storeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', index: true })
  ownerId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrderModel', required: true, index: true })
  orderId: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  stripeConnectAccountId: string;

  @Prop({ type: String, enum: Object.values(OrderStatusEnum), required: true })
  orderStatus: OrderStatusEnum;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  orderSnapshot: Record<string, unknown>;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', index: true })
  archivedByAdminId?: Types.ObjectId;

  @Prop({ type: String, default: '' })
  archivedByAdminEmail: string;
}

export type VendorStripeResetOrderArchiveDocument =
  HydratedDocument<VendorStripeResetOrderArchiveModel>;

export const VendorStripeResetOrderArchiveSchema = SchemaFactory.createForClass(
  VendorStripeResetOrderArchiveModel,
);

VendorStripeResetOrderArchiveSchema.index({ resetBatchId: 1, orderId: 1 });
