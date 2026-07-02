import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { EngagementPerformanceChannel } from './engagement-performance-event.schema';

@Schema({ timestamps: true, collection: 'engagement_performance_daily' })
export class EngagementPerformanceDailyModel {
  @Prop({ type: String, required: true, index: true })
  date: string;

  @Prop({
    type: String,
    enum: [...Object.values(EngagementPerformanceChannel), 'combined'],
    required: true,
    index: true,
  })
  channel: EngagementPerformanceChannel | 'combined';

  @Prop({ type: String, default: '' })
  region: string;

  @Prop({ type: Number, default: 0 })
  sent: number;

  @Prop({ type: Number, default: 0 })
  delivered: number;

  @Prop({ type: Number, default: 0 })
  opened: number;

  @Prop({ type: Number, default: 0 })
  clicked: number;

  @Prop({ type: Number, default: 0 })
  dismissed: number;

  @Prop({ type: Number, default: 0 })
  unsubscribed: number;

  @Prop({ type: Number, default: 0 })
  orders24h: number;

  @Prop({ type: Number, default: 0 })
  orders48h: number;

  @Prop({ type: Number, default: 0 })
  revenueAmount: number;

  @Prop({ type: String, default: 'CAD' })
  currency: string;

  @Prop({ type: Object, default: {} })
  skippedByReason: Record<string, number>;

  @Prop({ type: Object, default: {} })
  breakdowns: Record<string, unknown>;
}

export type EngagementPerformanceDailyDocument =
  HydratedDocument<EngagementPerformanceDailyModel>;

export const EngagementPerformanceDailySchema = SchemaFactory.createForClass(
  EngagementPerformanceDailyModel,
);

EngagementPerformanceDailySchema.index(
  { date: 1, channel: 1, region: 1 },
  { unique: true },
);
