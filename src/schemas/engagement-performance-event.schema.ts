import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum EngagementPerformanceChannel {
  PUSH_RECO = 'push_reco',
  EMAIL_NEWSLETTER = 'email_newsletter',
}

export enum EngagementPerformanceEventType {
  SENT = 'sent',
  DELIVERED = 'delivered',
  OPEN = 'open',
  CLICK = 'click',
  DISMISS = 'dismiss',
  UNSUBSCRIBE = 'unsubscribe',
  ORDER_24H = 'order_24h',
  ORDER_48H = 'order_48h',
  SKIPPED = 'skipped',
}

@Schema({ timestamps: true, collection: 'engagement_performance_events' })
export class EngagementPerformanceEventModel {
  @Prop({
    type: String,
    enum: Object.values(EngagementPerformanceChannel),
    required: true,
    index: true,
  })
  channel: EngagementPerformanceChannel;

  @Prop({
    type: String,
    enum: Object.values(EngagementPerformanceEventType),
    required: true,
    index: true,
  })
  event: EngagementPerformanceEventType;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  userId?: Types.ObjectId | null;

  @Prop({ type: String, default: '' })
  scheduleId: string;

  @Prop({ type: String, default: '' })
  campaignId: string;

  @Prop({ type: String, default: '' })
  candidateType: string;

  @Prop({ type: String, default: '' })
  refType: string;

  @Prop({ type: String, default: '' })
  refId: string;

  @Prop({ type: [String], default: [] })
  cuisineTags: string[];

  @Prop({ type: String, default: '' })
  copySource: string;

  @Prop({ type: String, default: '' })
  region: string;

  @Prop({ type: String, default: '' })
  skipReason: string;

  @Prop({ type: Number, default: null })
  revenueAmount: number | null;

  @Prop({ type: String, default: '' })
  currency: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>;

  @Prop({ type: Date, required: true, index: true })
  occurredAt: Date;
}

export type EngagementPerformanceEventDocument =
  HydratedDocument<EngagementPerformanceEventModel>;

export const EngagementPerformanceEventSchema = SchemaFactory.createForClass(
  EngagementPerformanceEventModel,
);

EngagementPerformanceEventSchema.index({ channel: 1, occurredAt: -1 });
EngagementPerformanceEventSchema.index({
  channel: 1,
  event: 1,
  occurredAt: -1,
});

const _eventTtlDays = (): number => {
  const raw = Number(process.env.ENGAGEMENT_PERFORMANCE_EVENTS_TTL_DAYS);
  return Number.isFinite(raw) && raw >= 7 ? Math.floor(raw) : 90;
};

EngagementPerformanceEventSchema.index(
  { occurredAt: 1 },
  { expireAfterSeconds: _eventTtlDays() * 24 * 60 * 60 },
);
