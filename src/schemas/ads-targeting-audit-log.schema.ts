import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

@Schema({
  timestamps: true,
  collection: 'ads_targeting_audit_logs',
  toJSON: { getters: true, virtuals: true },
})
export class AdsTargetingAuditLogModel extends BaseSchema {
  @Prop({ required: true, trim: true, index: true })
  action: string;

  @Prop({ required: true, trim: true, index: true, name: 'actor_key' })
  actorKey: string;

  @Prop({ required: false, trim: true, name: 'target_user_key', index: true })
  targetUserKey?: string;

  @Prop({ required: false, trim: true, name: 'target_campaign_id', index: true })
  targetCampaignId?: string;

  @Prop({ required: false, type: Object, default: {} })
  metadata?: Record<string, unknown>;
}

export const AdsTargetingAuditLogSchema = SchemaFactory.createForClass(
  AdsTargetingAuditLogModel,
);
