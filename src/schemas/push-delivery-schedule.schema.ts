import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum PushDeliveryScheduleStatus {
  PENDING = 'pending',
  SENT = 'sent',
  SKIPPED = 'skipped',
  FAILED = 'failed',
}

@Schema({ timestamps: true, collection: 'push_delivery_schedules' })
export class PushDeliveryScheduleModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  candidateId: Types.ObjectId;

  @Prop({ type: Date, required: true, index: true })
  scheduledAt: Date;

  @Prop({
    type: String,
    enum: Object.values(PushDeliveryScheduleStatus),
    default: PushDeliveryScheduleStatus.PENDING,
    index: true,
  })
  status: PushDeliveryScheduleStatus;

  @Prop({ type: String, default: '' })
  skipReason: string;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  @Prop({ type: Object, default: {} })
  copy: {
    title?: string;
    body?: string;
    source?: 'llama' | 'template';
    locale?: string;
  };

  @Prop({ type: String, default: '' })
  campaignId: string;

  @Prop({ type: String, default: '' })
  candidateType: string;

  @Prop({ type: Date, default: null })
  openedAt: Date | null;

  @Prop({ type: Date, default: null })
  dismissedAt: Date | null;

  @Prop({ type: Date, default: null })
  clickedAt: Date | null;

  @Prop({ type: String, default: '' })
  orderId24h: string;
}

export type PushDeliveryScheduleDocument =
  HydratedDocument<PushDeliveryScheduleModel>;

export const PushDeliveryScheduleSchema = SchemaFactory.createForClass(
  PushDeliveryScheduleModel,
);

PushDeliveryScheduleSchema.index({ userId: 1, scheduledAt: -1 });
PushDeliveryScheduleSchema.index({ status: 1, scheduledAt: 1 });
