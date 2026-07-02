import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum FoodNewsletterCampaignType {
  WISE_EAT_WEEKLY = 'wise_eat_weekly',
  STORE_SUBSCRIBER_DIGEST = 'store_subscriber_digest',
  FOOD_RECO_DIGEST = 'food_reco_digest',
}

@Schema({ timestamps: true, collection: 'food_newsletter_candidates' })
export class FoodNewsletterCandidateModel {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(FoodNewsletterCampaignType),
    required: true,
  })
  campaignType: FoodNewsletterCampaignType;

  @Prop({ type: Number, required: true, index: true })
  score: number;

  @Prop({ type: Object, default: {} })
  contentSnapshot: {
    stores?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
    promo?: Record<string, unknown> | null;
  };

  @Prop({ type: String, default: '' })
  locale: string;

  @Prop({ type: String, default: '' })
  region: string;

  @Prop({ type: Date, required: true, index: true })
  computedAt: Date;

  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  sentAt: Date | null;
}

export type FoodNewsletterCandidateDocument =
  HydratedDocument<FoodNewsletterCandidateModel>;

export const FoodNewsletterCandidateSchema = SchemaFactory.createForClass(
  FoodNewsletterCandidateModel,
);

FoodNewsletterCandidateSchema.index({ userId: 1, score: -1, expiresAt: 1 });
FoodNewsletterCandidateSchema.index(
  { userId: 1, campaignType: 1 },
  { unique: true },
);
FoodNewsletterCandidateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
