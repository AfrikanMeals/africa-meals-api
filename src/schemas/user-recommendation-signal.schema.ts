import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

export enum UserRecommendationSignalKind {
  PRODUCT_VIEW = 'product_view',
  STORE_VIEW = 'store_view',
}

@Schema({
  timestamps: true,
  collection: 'user_recommendation_signals',
  toJSON: { getters: true, virtuals: true },
})
export class UserRecommendationSignalModel extends BaseSchema {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
  })
  user: Types.ObjectId;

  @Prop({
    required: true,
    enum: Object.values(UserRecommendationSignalKind),
  })
  kind: UserRecommendationSignalKind;

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  refId: Types.ObjectId;
}

export const UserRecommendationSignalSchema = SchemaFactory.createForClass(
  UserRecommendationSignalModel,
);

UserRecommendationSignalSchema.index({ user: 1, createdAt: -1 });
/** Rétention ~90 j pour limiter la croissance ; les signaux récents suffisent au scoring. */
UserRecommendationSignalSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
