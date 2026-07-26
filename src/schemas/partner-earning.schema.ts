import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const PARTNER_EARNING_AXES = [
  'customer_order',
  'vendor_sales',
  'courier_gains',
] as const;
export type PartnerEarningAxis = (typeof PARTNER_EARNING_AXES)[number];

export const PARTNER_EARNING_STATUSES = [
  'PENDING',
  'TRANSFERRED',
  'FAILED',
] as const;
export type PartnerEarningStatus = (typeof PARTNER_EARNING_STATUSES)[number];

/**
 * Ledger gains affiliation Partner.
 * Idempotence : index unique (partnerUserId + axis + sourceType + sourceId).
 */
@Schema({ timestamps: true, collection: 'partner_earnings' })
export class PartnerEarningModel {
  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: true, index: true })
  partnerUserId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'PartnerSubscriptionPlanModel',
    required: true,
  })
  planId: Types.ObjectId;

  @Prop({ type: String, enum: PARTNER_EARNING_AXES, required: true })
  axis: PartnerEarningAxis;

  /** Ex. order | delivery_earning */
  @Prop({ type: String, required: true, trim: true })
  sourceType: string;

  @Prop({ type: String, required: true, trim: true })
  sourceId: string;

  @Prop({ type: String, trim: true, uppercase: true, default: '' })
  regionCode: string;

  @Prop({ type: Number, required: true, min: 0 })
  baseAmount: number;

  @Prop({ type: Number, required: true, min: 0 })
  commissionAmount: number;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  @Prop({ type: String, enum: ['fixed', 'percent'], default: 'percent' })
  feeMode: 'fixed' | 'percent';

  @Prop({ type: Number, default: 0, min: 0 })
  feeFixed: number;

  @Prop({ type: Number, default: 0, min: 0 })
  feePercent: number;

  @Prop({
    type: String,
    enum: PARTNER_EARNING_STATUSES,
    default: 'PENDING',
  })
  status: PartnerEarningStatus;

  @Prop({ type: String, trim: true, default: '' })
  stripeTransferId?: string;

  @Prop({ type: String, trim: true, default: '' })
  failureReason?: string;
}

export type PartnerEarningDocument = HydratedDocument<PartnerEarningModel>;

export const PartnerEarningSchema =
  SchemaFactory.createForClass(PartnerEarningModel);

PartnerEarningSchema.index(
  { partnerUserId: 1, axis: 1, sourceType: 1, sourceId: 1 },
  { unique: true },
);
