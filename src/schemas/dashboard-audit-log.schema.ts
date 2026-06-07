import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';
import { UserModel, UserTypeEnum } from './user.schema';

export enum DashboardAuditActionEnum {
  PAGE_VIEW = 'PAGE_VIEW',
  API_MUTATION = 'API_MUTATION',
  API_READ = 'API_READ',
  UI_ACTION = 'UI_ACTION',
}

@Schema({
  timestamps: true,
  collection: 'dashboard_audit_logs',
  toJSON: { getters: true, virtuals: true },
})
export class DashboardAuditLogModel extends BaseSchema {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    index: true,
    name: 'actor_user_id',
  })
  actorUserId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: UserTypeEnum, index: true, name: 'actor_type' })
  actorType: UserTypeEnum;

  @Prop({ required: false, trim: true, name: 'actor_email' })
  actorEmail?: string;

  @Prop({ required: false, trim: true, name: 'actor_name' })
  actorName?: string;

  @Prop({ required: true, trim: true, index: true })
  action: string;

  @Prop({ required: false, trim: true, index: true })
  category?: string;

  @Prop({ required: false, trim: true, index: true })
  path?: string;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    index: true,
    name: 'store_id',
  })
  storeId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: false, trim: true })
  resource?: string;

  @Prop({ required: false, trim: true, name: 'resource_id', index: true })
  resourceId?: string;

  @Prop({ required: false, type: Object, default: {} })
  metadata?: Record<string, unknown>;

  @Prop({ required: false, trim: true, name: 'user_agent' })
  userAgent?: string;

  @Prop({ required: false, trim: true })
  ip?: string;

  @Prop({ required: true, trim: true, default: 'admin-web' })
  source: string;

  @Prop({ required: true, index: true, name: 'occurred_at' })
  occurredAt: Date;
}

export const DashboardAuditLogSchema = SchemaFactory.createForClass(
  DashboardAuditLogModel,
);

DashboardAuditLogSchema.index({ occurredAt: -1 });
DashboardAuditLogSchema.index({ storeId: 1, occurredAt: -1 });
DashboardAuditLogSchema.index({ actorUserId: 1, occurredAt: -1 });
