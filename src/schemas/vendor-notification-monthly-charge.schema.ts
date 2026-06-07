import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { StoreModel } from './store.schema';

export enum VendorNotificationChargeStatusEnum {
  PENDING = 'pending',
  INVOICED = 'invoiced',
  PAID = 'paid',
  WAIVED = 'waived',
  OVERDUE = 'overdue',
}

@Schema({
  timestamps: true,
  collection: 'vendor_notification_monthly_charges',
})
export class VendorNotificationMonthlyChargeModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  store: MongooseSchema.Types.ObjectId;

  /** Période facturée (YYYY-MM). */
  @Prop({ required: true, index: true, name: 'billing_month' })
  billingMonth: string;

  @Prop({ required: true, default: 0, name: 'sms_count' })
  smsCount: number;

  @Prop({ required: true, default: 0, name: 'sms_unit_cost_cad' })
  smsUnitCostCad: number;

  @Prop({ required: true, default: 0, name: 'sms_total_cad' })
  smsTotalCad: number;

  @Prop({ required: true, default: 0, name: 'push_count' })
  pushCount: number;

  @Prop({ required: true, default: 0, name: 'email_count' })
  emailCount: number;

  @Prop({
    required: true,
    enum: VendorNotificationChargeStatusEnum,
    default: VendorNotificationChargeStatusEnum.PENDING,
  })
  status: VendorNotificationChargeStatusEnum;

  @Prop({ required: false, default: null, name: 'invoiced_at' })
  invoicedAt?: Date | null;

  @Prop({ required: false, default: null, name: 'paid_at' })
  paidAt?: Date | null;

  @Prop({ required: false, default: null, name: 'due_at' })
  dueAt?: Date | null;

  @Prop({ required: false, default: null, name: 'stripe_checkout_session_id' })
  stripeCheckoutSessionId?: string | null;

  @Prop({ required: false, default: null, name: 'stripe_payment_intent_id' })
  stripePaymentIntentId?: string | null;

  @Prop({ required: false, default: null, name: 'checkout_url' })
  checkoutUrl?: string | null;

  @Prop({ required: false, default: 'CAD', trim: true })
  currency?: string;
}

export const VendorNotificationMonthlyChargeSchema =
  SchemaFactory.createForClass(VendorNotificationMonthlyChargeModel);

VendorNotificationMonthlyChargeSchema.index(
  { store: 1, billingMonth: 1 },
  { unique: true },
);
