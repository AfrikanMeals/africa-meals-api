import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

export enum AdsTargetingEventTypeEnum {
  ITEM_VIEW = 'item_view',
  ITEM_CLICK = 'item_click',
  ITEM_LIKE = 'item_like',
  ITEM_DISLIKE = 'item_dislike',
  SEARCH_QUERY = 'search_query',
  AD_IMPRESSION = 'ad_impression',
  AD_CLICK = 'ad_click',
  AD_DISMISS = 'ad_dismiss',
  SESSION_START = 'session_start',
  SESSION_END = 'session_end',
  PURCHASE = 'purchase',
  CATEGORY_BROWSE = 'category_browse',
}

@Schema({
  timestamps: true,
  collection: 'ads_targeting_events',
  toJSON: { getters: true, virtuals: true },
})
export class AdsTargetingEventModel extends BaseSchema {
  @Prop({ required: true, name: 'user_key', index: true, trim: true })
  userKey: string;

  @Prop({ required: true, name: 'device_id', index: true, trim: true })
  deviceId: string;

  @Prop({ required: true, name: 'session_id', index: true, trim: true })
  sessionId: string;

  @Prop({ required: true, name: 'app_version', trim: true })
  appVersion: string;

  @Prop({ required: true, name: 'os', trim: true })
  os: string;

  @Prop({ required: true, enum: AdsTargetingEventTypeEnum, index: true })
  eventType: AdsTargetingEventTypeEnum;

  @Prop({ required: false, name: 'item_id', trim: true })
  itemId?: string;

  @Prop({ required: false, name: 'category', trim: true, index: true })
  category?: string;

  @Prop({ required: false, name: 'ad_id', trim: true, index: true })
  adId?: string;

  @Prop({ required: false, name: 'campaign_id', trim: true, index: true })
  campaignId?: string;

  @Prop({ required: false, name: 'placement', trim: true })
  placement?: string;

  @Prop({ required: false, name: 'country', trim: true, uppercase: true })
  country?: string;

  @Prop({ required: false, type: Object, default: {} })
  metadata?: Record<string, unknown>;

  @Prop({ required: true, name: 'timestamp', index: true })
  timestamp: Date;
}

export const AdsTargetingEventSchema = SchemaFactory.createForClass(
  AdsTargetingEventModel,
);

AdsTargetingEventSchema.index({ userKey: 1, timestamp: -1 });
AdsTargetingEventSchema.index({ eventType: 1, timestamp: -1 });
