import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Document } from 'mongoose';
import { AdCampaignModel } from './ad-campaign.schema';
import { UserModel } from './user.schema';

export enum AdCampaignEventTypeEnum {
  IMPRESSION = 'IMPRESSION',
  CLICK = 'CLICK',
}

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'ad_campaign_events',
})
export class AdCampaignEventModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: AdCampaignModel.name,
    required: true,
    index: true,
  })
  campaign: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: false,
  })
  user?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: AdCampaignEventTypeEnum })
  eventType: AdCampaignEventTypeEnum;

  /** PRODUCT ou DRINK (tracé par item du slider). */
  @Prop({ required: true, maxlength: 16 })
  itemType: string;

  @Prop({ required: true })
  itemId: string;

  @Prop({ required: false, maxlength: 128 })
  clientInstallId?: string;
}

export const AdCampaignEventSchema =
  SchemaFactory.createForClass(AdCampaignEventModel);

AdCampaignEventSchema.index({ campaign: 1, createdAt: -1 });
AdCampaignEventSchema.index({ campaign: 1, eventType: 1, createdAt: -1 });

export type AdCampaignEventModelDocument = AdCampaignEventModel & Document;
