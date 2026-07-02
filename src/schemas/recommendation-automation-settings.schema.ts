import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Paramètres admin — push reco intelligent (RECOMMENDATION.md). */
@Schema({ timestamps: true, collection: 'recommendation_automation_settings' })
export class RecommendationAutomationSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Kill switch global — désactive classifier, planner et delivery. */
  @Prop({ type: Boolean, default: false })
  pushRecoEnabled: boolean;

  /** Pourcentage d'utilisateurs éligibles (0–100). */
  @Prop({ type: Number, default: 10, min: 0, max: 100 })
  pushRecoRolloutPct: number;

  @Prop({ type: Boolean, default: true })
  classifierCronEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  plannerCronEnabled: boolean;

  @Prop({ type: String, default: '0 4 * * *' })
  classifierCronExpression: string;

  @Prop({ type: String, default: '*/20 * * * *' })
  plannerCronExpression: string;

  /** Copy via Llama/Ollama (sinon templates i18n). */
  @Prop({ type: Boolean, default: false })
  llmCopyEnabled: boolean;

  @Prop({ type: String, default: 'llama3.2:3b' })
  llmModel: string;

  @Prop({ type: Number, default: 1 })
  maxDaily: number;

  @Prop({ type: Number, default: 3 })
  maxWeekly: number;

  @Prop({ type: Number, default: 4 })
  minGapHours: number;

  @Prop({ type: String, default: '22:00' })
  quietStart: string;

  @Prop({ type: String, default: '08:30' })
  quietEnd: string;

  @Prop({ type: Number, default: 62 })
  minScore: number;

  /** Max % même cuisine sur 7 jours (anti-bulle). */
  @Prop({ type: Number, default: 70 })
  cuisineDiversityMaxPct: number;

  @Prop({ type: Boolean, default: true })
  reorderFavoriteEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  dailyMenuMatchEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  storeReturnEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  trendingLocalEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  crossCuisineDiscoveryEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  promoEligibleEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  nearbyOpenEnabled: boolean;

  /** Poids scoring composite (0–100 scale inputs). */
  @Prop({ type: Number, default: 25 })
  weightCuisineAffinity: number;

  @Prop({ type: Number, default: 25 })
  weightProductAffinity: number;

  @Prop({ type: Number, default: 15 })
  weightUrgency: number;

  @Prop({ type: Number, default: 10 })
  weightNovelty: number;

  @Prop({ type: Number, default: 10 })
  weightPromoMargin: number;

  @Prop({ type: Number, default: 20 })
  weightPushFatigue: number;

  @Prop({ type: Number, default: 15 })
  weightNotificationRecency: number;

  @Prop({ type: Number, default: 15 })
  weightCuisineOverrepresentation: number;
}

export type RecommendationAutomationSettingsDocument =
  HydratedDocument<RecommendationAutomationSettingsModel>;

export const RecommendationAutomationSettingsSchema =
  SchemaFactory.createForClass(RecommendationAutomationSettingsModel);
