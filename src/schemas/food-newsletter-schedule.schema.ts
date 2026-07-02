import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FoodNewsletterCampaignType } from './food-newsletter-candidate.schema';

export enum FoodNewsletterScheduleStatus {
  PENDING = 'pending',
  SENT = 'sent',
  SKIPPED = 'skipped',
  FAILED = 'failed',
}

@Schema({ timestamps: true, collection: 'food_newsletter_schedule' })
export class FoodNewsletterScheduleModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  email: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  candidateId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FoodNewsletterCampaignType),
    required: true,
  })
  campaignType: FoodNewsletterCampaignType;

  @Prop({ type: Date, required: true, index: true })
  scheduledAt: Date;

  @Prop({
    type: String,
    enum: Object.values(FoodNewsletterScheduleStatus),
    default: FoodNewsletterScheduleStatus.PENDING,
    index: true,
  })
  status: FoodNewsletterScheduleStatus;

  @Prop({ type: String, default: '' })
  skipReason: string;

  @Prop({ type: Object, default: {} })
  contentSnapshot: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  copy: {
    subject?: string;
    preheader?: string;
    intro?: string;
    cta?: string;
    heroLine?: string;
    source?: 'llama' | 'template';
  };

  @Prop({ type: String, default: '' })
  campaignId: string;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;

  @Prop({ type: Date, default: null })
  openedAt: Date | null;

  @Prop({ type: Date, default: null })
  clickedAt: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  orderId48h: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  revenue48h: number | null;
}

export type FoodNewsletterScheduleDocument =
  HydratedDocument<FoodNewsletterScheduleModel>;

export const FoodNewsletterScheduleSchema = SchemaFactory.createForClass(
  FoodNewsletterScheduleModel,
);

FoodNewsletterScheduleSchema.index({ userId: 1, sentAt: -1 });
FoodNewsletterScheduleSchema.index({ status: 1, scheduledAt: 1 });
