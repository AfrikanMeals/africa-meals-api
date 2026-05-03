import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

/**
 * Profil pré-calculé par le job (vues récentes par utilisateur) pour enrichir le fil
 * sans rescanner toute l’historique à chaque requête.
 */
@Schema({
  timestamps: true,
  collection: 'user_recommendation_digests',
  toJSON: { getters: true, virtuals: true },
})
export class UserRecommendationDigestModel extends BaseSchema {
  @Prop({
    required: true,
    unique: true,
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    name: 'user',
  })
  user: Types.ObjectId;

  @Prop({ required: true, name: 'computed_at' })
  computedAt: Date;

  @Prop({ type: [String], default: [], name: 'top_viewed_product_ids' })
  topViewedProductIds: string[];

  @Prop({ type: [String], default: [], name: 'top_viewed_store_ids' })
  topViewedStoreIds: string[];
}

export const UserRecommendationDigestSchema = SchemaFactory.createForClass(
  UserRecommendationDigestModel,
);

UserRecommendationDigestSchema.index({ user: 1 }, { unique: true });
UserRecommendationDigestSchema.index({ computedAt: -1 });
