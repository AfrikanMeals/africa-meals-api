import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Paramètres admin — digest email food / boutiques abonnées (NEWSLETTER.md). */
@Schema({ timestamps: true, collection: 'newsletter_automation_settings' })
export class NewsletterAutomationSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Kill switch global — désactive classifier, planner et envoi SMTP. */
  @Prop({ type: Boolean, default: false })
  foodNewsletterEnabled: boolean;

  @Prop({ type: Number, default: 10, min: 0, max: 100 })
  foodNewsletterRolloutPct: number;

  @Prop({ type: Boolean, default: true })
  classifierCronEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  plannerCronEnabled: boolean;

  @Prop({ type: String, default: '0 5 * * *' })
  classifierCronExpression: string;

  @Prop({ type: String, default: '0 9 * * 2,4' })
  plannerCronExpression: string;

  @Prop({ type: Boolean, default: false })
  llmCopyEnabled: boolean;

  @Prop({ type: String, default: 'llama3.2:3b' })
  llmModel: string;

  /** Max emails reco / 7 jours. */
  @Prop({ type: Number, default: 1 })
  maxWeekly: number;

  /** Max emails reco / 30 jours. */
  @Prop({ type: Number, default: 3 })
  maxMonthly: number;

  /** Intervalle minimum entre deux emails (jours). */
  @Prop({ type: Number, default: 7 })
  minGapDays: number;

  /** Max emails même boutique / 14 j. */
  @Prop({ type: Number, default: 1 })
  maxSameStoreDays: number;

  /** Pause après N non-ouvertures consécutives (jours). */
  @Prop({ type: Number, default: 21 })
  pauseAfterNonOpensDays: number;

  @Prop({ type: Number, default: 2 })
  pauseAfterNonOpensCount: number;

  @Prop({ type: Number, default: 58 })
  minScore: number;

  @Prop({ type: Number, default: 70 })
  cuisineDiversityMaxPct: number;

  /** Max % découverte cross-culture dans un digest. */
  @Prop({ type: Number, default: 30 })
  crossCuisineMaxPct: number;

  @Prop({ type: String, default: '10:00' })
  sendWindowStart: string;

  @Prop({ type: String, default: '11:30' })
  sendWindowEnd: string;

  @Prop({ type: Number, default: 45 })
  jitterMinutes: number;

  @Prop({ type: Number, default: 25 })
  batchSize: number;

  @Prop({ type: Boolean, default: true })
  wiseEatWeeklyEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  storeSubscriberDigestEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  foodRecoDigestEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  subscribedStoresSectionEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  recommendedSectionEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  promoSectionEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  reorderSectionEnabled: boolean;
}

export type NewsletterAutomationSettingsDocument =
  HydratedDocument<NewsletterAutomationSettingsModel>;

export const NewsletterAutomationSettingsSchema = SchemaFactory.createForClass(
  NewsletterAutomationSettingsModel,
);
