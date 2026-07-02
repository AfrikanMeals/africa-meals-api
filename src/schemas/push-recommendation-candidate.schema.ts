import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum PushRecommendationCandidateType {
  REORDER_FAVORITE = 'REORDER_FAVORITE',
  DAILY_MENU_MATCH = 'DAILY_MENU_MATCH',
  STORE_RETURN = 'STORE_RETURN',
  TRENDING_LOCAL = 'TRENDING_LOCAL',
  CROSS_CUISINE_DISCOVERY = 'CROSS_CUISINE_DISCOVERY',
  PROMO_ELIGIBLE = 'PROMO_ELIGIBLE',
  NEARBY_OPEN = 'NEARBY_OPEN',
}

@Schema({ timestamps: true, collection: 'push_recommendation_candidates' })
export class PushRecommendationCandidateModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(PushRecommendationCandidateType),
    required: true,
  })
  candidateType: PushRecommendationCandidateType;

  @Prop({ type: String, required: true })
  refType: 'product' | 'store' | 'promo';

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  refId: Types.ObjectId;

  @Prop({ type: Number, required: true, index: true })
  score: number;

  @Prop({ type: [String], default: [] })
  cuisineTags: string[];

  @Prop({ type: [String], default: [] })
  reasonTags: string[];

  @Prop({ type: Object, default: {} })
  contextSnapshot: Record<string, unknown>;

  @Prop({ type: Date, required: true, index: true })
  computedAt: Date;

  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;
}

export type PushRecommendationCandidateDocument =
  HydratedDocument<PushRecommendationCandidateModel>;

export const PushRecommendationCandidateSchema = SchemaFactory.createForClass(
  PushRecommendationCandidateModel,
);

PushRecommendationCandidateSchema.index({ userId: 1, score: -1, expiresAt: 1 });
PushRecommendationCandidateSchema.index(
  { userId: 1, refType: 1, refId: 1, candidateType: 1 },
  { unique: true },
);
PushRecommendationCandidateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
