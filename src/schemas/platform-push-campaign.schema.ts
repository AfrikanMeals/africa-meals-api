import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { UserModel } from './user.schema';

/** Stats d’envoi FCM après POST campagne. */
export type PlatformPushCampaignStats = {
  targetedUsers: number;
  deviceCount: number;
  sent: number;
  failures: number;
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

  @Prop({ type: Date, required: true })
  sentAt: Date;

  @Prop({
    type: {
      targetedUsers: { type: Number, default: 0 },
      deviceCount: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
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
