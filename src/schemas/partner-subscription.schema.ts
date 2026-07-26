import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const PARTNER_SUBSCRIPTION_BILLING_PERIODS = [
  'MONTHLY',
  'YEARLY',
] as const;
export type PartnerSubscriptionBillingPeriod =
  (typeof PARTNER_SUBSCRIPTION_BILLING_PERIODS)[number];

export const PARTNER_SUBSCRIPTION_STATUSES = [
  'PENDING_PAYMENT',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
] as const;
export type PartnerSubscriptionStatus =
  (typeof PARTNER_SUBSCRIPTION_STATUSES)[number];

/** Abonnement souscrit par un compte PARTNER (user-scoped, pas de boutique). */
@Schema({ timestamps: true, collection: 'partner_subscriptions' })
export class PartnerSubscriptionModel {
  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: true, index: true })
  owner: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'PartnerSubscriptionPlanModel',
    required: true,
  })
  plan: Types.ObjectId;

  @Prop({
    type: String,
    enum: PARTNER_SUBSCRIPTION_BILLING_PERIODS,
    required: true,
  })
  billingPeriod: PartnerSubscriptionBillingPeriod;

  @Prop({
    type: String,
    enum: PARTNER_SUBSCRIPTION_STATUSES,
    default: 'ACTIVE',
  })
  status: PartnerSubscriptionStatus;

  @Prop({ type: Date, required: true })
  startsAt: Date;

  @Prop({ type: Date, required: true })
  endsAt: Date;

  @Prop({ type: Number, required: true, min: 0 })
  pricePaid: number;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

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

  @Prop({ type: Boolean, default: false })
  isOffer: boolean;

  @Prop({ type: String, trim: true, default: '' })
  offerNote?: string;
}

export type PartnerSubscriptionDocument =
  HydratedDocument<PartnerSubscriptionModel>;

export const PartnerSubscriptionSchema = SchemaFactory.createForClass(
  PartnerSubscriptionModel,
);

PartnerSubscriptionSchema.index({ owner: 1, status: 1 });
