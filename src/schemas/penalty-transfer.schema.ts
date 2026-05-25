import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import {
  PenaltyPartyEnum,
  PenaltyRouteEnum,
  PenaltyStatusEnum,
  PenaltyStripeStepKindEnum,
} from '@modules/penalties/penalty.types';

@Schema({ _id: false })
export class PenaltyStripeStepModel {
  @Prop({ required: true, enum: Object.values(PenaltyStripeStepKindEnum) })
  kind: PenaltyStripeStepKindEnum;

  @Prop({ required: true, trim: true })
  stripeId: string;

  @Prop({ required: true, min: 0 })
  amountCents: number;

  @Prop({ required: false, trim: true })
  connectAccountId?: string;
}

export const PenaltyStripeStepSchema = SchemaFactory.createForClass(
  PenaltyStripeStepModel,
);

@Schema({
  timestamps: true,
  collection: 'stripe_penalties',
})
export class PenaltyTransferModel extends BaseSchema {
  @Prop({ required: true, enum: Object.values(PenaltyRouteEnum) })
  route: PenaltyRouteEnum;

  @Prop({ required: true, enum: Object.values(PenaltyPartyEnum) })
  fromParty: PenaltyPartyEnum;

  @Prop({ required: true, enum: Object.values(PenaltyPartyEnum) })
  toParty: PenaltyPartyEnum;

  @Prop({ required: true, min: 1 })
  amountCents: number;

  @Prop({ required: true, default: 'cad', trim: true, lowercase: true })
  currency: string;

  @Prop({
    required: true,
    enum: Object.values(PenaltyStatusEnum),
    default: PenaltyStatusEnum.PENDING,
  })
  status: PenaltyStatusEnum;

  @Prop({ required: false, trim: true, maxlength: 64 })
  reasonCode?: string;

  /** Libellé affiché (motif intégré, personnalisé ou « autre »). */
  @Prop({ required: false, trim: true, maxlength: 200 })
  reasonLabel?: string;

  @Prop({ required: false, trim: true, maxlength: 500 })
  reasonDetails?: string;

  @Prop({ required: false, trim: true, maxlength: 2000 })
  note?: string;

  @Prop({ required: false, default: true, name: 'notify_participants' })
  notifyParticipants?: boolean;

  @Prop({ type: [Object], default: [], name: 'participant_emails' })
  participantEmails?: Array<{
    party: string;
    role: string;
    email: string;
    name: string;
    sent: boolean;
    error?: string;
  }>;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'OrderModel',
  })
  order?: string;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'StoreModel',
  })
  store?: string;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  vendorUser?: string;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  deliveryUser?: string;

  @Prop({ required: false, trim: true })
  fromConnectAccountId?: string;

  @Prop({ required: false, trim: true })
  toConnectAccountId?: string;

  @Prop({ type: [PenaltyStripeStepSchema], default: [] })
  stripeSteps: PenaltyStripeStepModel[];

  @Prop({ required: false, trim: true })
  failureCode?: string;

  @Prop({ required: false, trim: true, maxlength: 2000 })
  failureMessage?: string;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  createdByAdmin?: string;

  @Prop({ required: false, trim: true, maxlength: 120 })
  idempotencyKey?: string;
}

export const PenaltyTransferSchema = SchemaFactory.createForClass(
  PenaltyTransferModel,
);

PenaltyTransferSchema.index({ createdAt: -1 });
PenaltyTransferSchema.index({ status: 1, createdAt: -1 });
PenaltyTransferSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
