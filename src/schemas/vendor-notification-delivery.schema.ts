import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';
import {
  VendorNotificationCategory,
  VendorNotificationChannel,
} from '@modules/vendor-notifications/vendor-notification.constants';

export enum VendorNotificationDeliveryStatusEnum {
  SENT = 'sent',
  SKIPPED = 'skipped',
  FAILED = 'failed',
}

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'vendor_notification_deliveries',
})
export class VendorNotificationDeliveryModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  store: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: false,
    default: null,
  })
  recipientUser?: MongooseSchema.Types.ObjectId | null;

  @Prop({ required: true, index: true })
  category: VendorNotificationCategory;

  @Prop({ required: true, index: true })
  channel: VendorNotificationChannel;

  @Prop({
    required: true,
    enum: VendorNotificationDeliveryStatusEnum,
    default: VendorNotificationDeliveryStatusEnum.SENT,
  })
  status: VendorNotificationDeliveryStatusEnum;

  @Prop({ required: false, default: '' })
  title?: string;

  @Prop({ required: false, default: '' })
  body?: string;

  @Prop({ required: false, default: null, name: 'unit_cost_cad' })
  unitCostCad?: number | null;

  @Prop({ required: false, default: null, name: 'external_id' })
  externalId?: string | null;

  @Prop({ required: false, default: null, name: 'skip_reason' })
  skipReason?: string | null;

  @Prop({ required: false, default: null, name: 'error_message' })
  errorMessage?: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata?: Record<string, string>;

  @Prop({ required: true, default: () => new Date(), index: true })
  deliveredAt: Date;

  /** YYYY-MM pour agrégation facturation SMS */
  @Prop({ required: true, index: true, name: 'billing_month' })
  billingMonth: string;
}

export const VendorNotificationDeliverySchema = SchemaFactory.createForClass(
  VendorNotificationDeliveryModel,
);

VendorNotificationDeliverySchema.index({ store: 1, billingMonth: 1, channel: 1 });
VendorNotificationDeliverySchema.index({ store: 1, deliveredAt: -1 });
