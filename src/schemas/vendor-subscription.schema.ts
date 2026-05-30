import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { HydratedDocument } from 'mongoose';

export const VENDOR_SUBSCRIPTION_BILLING_PERIODS = [
  'MONTHLY',
  'YEARLY',
] as const;
export type VendorSubscriptionBillingPeriod =
  (typeof VENDOR_SUBSCRIPTION_BILLING_PERIODS)[number];

export const VENDOR_SUBSCRIPTION_STATUSES = [
  'PENDING_PAYMENT',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
] as const;
export type VendorSubscriptionStatus =
  (typeof VENDOR_SUBSCRIPTION_STATUSES)[number];

/** Abonnement souscrit par une boutique. */
@Schema({ timestamps: true, collection: 'vendor_subscriptions' })
export class VendorSubscriptionModel {
  @Prop({
    type: Types.ObjectId,
    ref: 'StoreModel',
    required: true,
    index: true,
  })
  store: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: true, index: true })
  owner: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'SubscriptionPlanModel',
    required: true,
  })
  plan: Types.ObjectId;

  @Prop({
    type: String,
    enum: VENDOR_SUBSCRIPTION_BILLING_PERIODS,
    required: true,
  })
  billingPeriod: VendorSubscriptionBillingPeriod;

  @Prop({
    type: String,
    enum: VENDOR_SUBSCRIPTION_STATUSES,
    default: 'ACTIVE',
  })
  status: VendorSubscriptionStatus;

  @Prop({ type: Date, required: true })
  startsAt: Date;

  @Prop({ type: Date, required: true })
  endsAt: Date;

  @Prop({ type: Number, required: true, min: 0 })
  pricePaid: number;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  /** Copie du nom du plan au moment de la souscription. */
  @Prop({ type: String, trim: true, default: '' })
  planName: string;

  @Prop({ type: String, trim: true, sparse: true, index: true })
  stripeCheckoutSessionId?: string;

  @Prop({ type: String, trim: true, sparse: true, index: true })
  stripePaymentIntentId?: string;

  @Prop({ type: Boolean, default: false })
  isTrial: boolean;

  @Prop({ type: Date })
  trialEndsAt?: Date;

  /** Valeurs `trialReminderDays` déjà notifiées pour cet essai. */
  @Prop({ type: [Number], default: [] })
  trialRemindersSent: number[];
}

export type VendorSubscriptionDocument =
  HydratedDocument<VendorSubscriptionModel>;

export const VendorSubscriptionSchema = SchemaFactory.createForClass(
  VendorSubscriptionModel,
);

VendorSubscriptionSchema.index({ store: 1, status: 1, endsAt: -1 });
