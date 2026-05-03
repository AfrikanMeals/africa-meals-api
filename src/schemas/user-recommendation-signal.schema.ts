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
/** Anti-spam + requêtes « dernier signal » pour dédoublonnage. */
UserRecommendationSignalSchema.index({
  user: 1,
  kind: 1,
  refId: 1,
  createdAt: -1,
});

const _signalTtlSeconds = (): number => {
  const raw = Number(process.env.RECOMMENDATION_SIGNAL_TTL_SECONDS);
  if (Number.isFinite(raw) && raw >= 86_400) {
    return Math.floor(raw);
  }
  return 90 * 24 * 60 * 60;
};

/** Rétention configurable (`RECOMMENDATION_SIGNAL_TTL_SECONDS`, min 1j). */
UserRecommendationSignalSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: _signalTtlSeconds() },
);
