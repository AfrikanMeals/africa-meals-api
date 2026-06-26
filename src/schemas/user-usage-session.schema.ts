import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

export enum UserUsageSourceEnum {
  MOBILE = 'mobile',
  ADMIN = 'admin',
}

@Schema({
  timestamps: true,
  collection: 'user_usage_sessions',
  toJSON: { getters: true, virtuals: true },
})
export class UserUsageSessionModel extends BaseSchema {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    index: true,
    name: 'user_id',
  })
  userId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: UserUsageSourceEnum, index: true })
  source: UserUsageSourceEnum;

  @Prop({ required: true, trim: true, index: true, name: 'session_id' })
  sessionId: string;

  @Prop({ required: true, index: true, name: 'started_at' })
  startedAt: Date;

  @Prop({ required: true, index: true, name: 'last_active_at' })
  lastActiveAt: Date;

  @Prop({ required: false, name: 'ended_at' })
  endedAt?: Date;

  @Prop({ required: false, min: 0, name: 'duration_sec' })
  durationSec?: number;
}

export const UserUsageSessionSchema = SchemaFactory.createForClass(
  UserUsageSessionModel,
);

UserUsageSessionSchema.index({ userId: 1, source: 1, startedAt: -1 });
UserUsageSessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true });
UserUsageSessionSchema.index(
  { endedAt: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: { endedAt: { $exists: true } },
  },
);
