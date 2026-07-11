import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import type { UserModel } from './user.schema';

/**
 * Snapshot journalier perf livreur (carte mobile).
 * Écrit au plus 1×/jour (GET froid ou POST sync) — pas d’agrégation à chaque requête.
 */
@Schema({
  timestamps: true,
  collection: 'delivery_agent_daily_performance',
})
export class DeliveryAgentDailyPerformanceModel extends BaseSchema {
  @Prop({
    required: true,
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
    index: true,
  })
  deliveryAgent: UserModel;

  /** Clé calendaire locale serveur `YYYY-MM-DD`. */
  @Prop({ required: true, trim: true, maxlength: 10 })
  dayKey: string;

  @Prop({ required: true, min: 0, default: 0 })
  ordersShippedToday: number;

  @Prop({ required: false, min: 0, max: 5, default: null })
  averageRating: number | null;

  @Prop({ required: true, min: 0, default: 0 })
  ratingCount: number;

  /** Distance locale mobile (km), optionnelle. */
  @Prop({ required: false, min: 0, default: null })
  distanceKmToday: number | null;

  @Prop({ required: true, type: Date })
  syncedAt: Date;
}

export const DeliveryAgentDailyPerformanceSchema = SchemaFactory.createForClass(
  DeliveryAgentDailyPerformanceModel,
);

DeliveryAgentDailyPerformanceSchema.index(
  { deliveryAgent: 1, dayKey: 1 },
  { unique: true },
);

export type DeliveryAgentDailyPerformanceModelDocument =
  DeliveryAgentDailyPerformanceModel & Document;
