import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { UserModel } from './user.schema';

/** Répartition des jetons ciblés (pas de version d’OS stockée). */
export type PlatformPushCampaignPlatformStats = {
  ios: number;
  android: number;
  other: number;
};

/** Stats d’envoi FCM (cumulées par les lots de la file). */
export type PlatformPushCampaignStats = {
  targetedUsers: number;
  deviceCount: number;
  sent: number;
  failures: number;
  byPlatform: PlatformPushCampaignPlatformStats;
};

export type PlatformPushCampaignCursor = {
  audienceIndex: number;
  lastUserId?: string;
};

/**
 * Historique des campagnes push Marketing (admin.marketing).
 * Distinct des campagnes pub Ads Panel (`ad_promo`).
 */
@Schema({
  timestamps: true,
  collection: 'platform_push_campaigns',
  toJSON: { virtuals: true },
})
export class PlatformPushCampaignModel extends Document {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  /** URL publique mediathèque (image rich FCM optionnelle). */
  @Prop({ required: false, trim: true })
  imageUrl?: string;

  /** CUSTOMER | VENDOR | COURIER (multi-select). */
  @Prop({ type: [String], required: true, default: [] })
  audiences: string[];

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
  })
  createdBy: MongooseSchema.Types.ObjectId;

  /** Renseigné à la fin de l’envoi. Absent tant que la file n’a pas terminé. */
  @Prop({ type: Date, required: false })
  sentAt?: Date;

  /**
   * queued | running | paused | completed | failed | cancelled.
   * Documents d’avant la file : absence = completed.
   */
  @Prop({ required: false, default: 'completed' })
  status?: string;

  /** Reprise après pause : audience courante + dernier user déjà traité. */
  @Prop({ type: Object, required: false })
  cursor?: PlatformPushCampaignCursor;

  @Prop({
    type: {
      targetedUsers: { type: Number, default: 0 },
      deviceCount: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
      byPlatform: {
        type: {
          ios: { type: Number, default: 0 },
          android: { type: Number, default: 0 },
          other: { type: Number, default: 0 },
        },
        default: () => ({ ios: 0, android: 0, other: 0 }),
      },
    },
    required: true,
  })
  stats: PlatformPushCampaignStats;
}

export const PlatformPushCampaignSchema = SchemaFactory.createForClass(
  PlatformPushCampaignModel,
);

PlatformPushCampaignSchema.index({ sentAt: -1 });
PlatformPushCampaignSchema.index({ createdBy: 1, sentAt: -1 });
