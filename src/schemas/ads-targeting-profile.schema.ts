import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

@Schema({
  timestamps: true,
  collection: 'ads_targeting_profiles',
  toJSON: { getters: true, virtuals: true },
})
export class AdsTargetingProfileModel extends BaseSchema {
  @Prop({ required: true, unique: true, name: 'user_key', index: true, trim: true })
  userKey: string;

  @Prop({ type: [String], default: [], name: 'top_categories' })
  topCategories: string[];

  @Prop({ type: Object, default: {}, name: 'interest_scores' })
  interestScores: Record<string, number>;

  @Prop({ required: true, default: 0, name: 'engagement_rate' })
  engagementRate: number;

  @Prop({ required: false, name: 'last_active' })
  lastActive?: Date;

  @Prop({ required: true, default: 'new_user', index: true })
  segment: string;

  @Prop({ required: false, name: 'country', uppercase: true, trim: true })
  country?: string;

  @Prop({ required: false, name: 'language', trim: true })
  language?: string;

  @Prop({ required: true, default: 0, name: 'conversion_probability' })
  conversionProbability: number;

  @Prop({ required: true, default: 0, name: 'sessions_30d' })
  sessions30d: number;

  @Prop({ required: true, name: 'last_computed_at' })
  lastComputedAt: Date;
}

export const AdsTargetingProfileSchema = SchemaFactory.createForClass(
  AdsTargetingProfileModel,
);

AdsTargetingProfileSchema.index({ userKey: 1 }, { unique: true });
