import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

/** Clé unique du document agrégé (un seul snapshot « global » par version). */
export const RECOMMENDATION_GLOBAL_SNAPSHOT_KEY = 'global_v1';

/**
 * Résultat du job récurrent d’agrégation / « entraînement » léger (pas de ML externe) :
 * listes tendance pré-calculées à partir des signaux, favoris implicites (vues), commandes, notes.
 */
@Schema({
  timestamps: true,
  collection: 'recommendation_training_snapshots',
  toJSON: { getters: true, virtuals: true },
})
export class RecommendationTrainingSnapshotModel extends BaseSchema {
  @Prop({ required: true, unique: true, name: 'doc_key' })
  docKey: string;

  @Prop({ required: true, name: 'computed_at' })
  computedAt: Date;

  /** Plats tendance (ids string), ordre décroissant de pertinence batch. */
  @Prop({ type: [String], default: [], name: 'trend_product_ids' })
  trendProductIds: string[];

  /** Boutiques tendance (ids). */
  @Prop({ type: [String], default: [], name: 'trend_store_ids' })
  trendStoreIds: string[];

  /** Boissons tendance (ids). */
  @Prop({ type: [String], default: [], name: 'trend_drink_ids' })
  trendDrinkIds: string[];

  @Prop({
    type: Object,
    default: {},
    name: 'run_meta',
  })
  runMeta: Record<string, unknown>;
}

export const RecommendationTrainingSnapshotSchema = SchemaFactory.createForClass(
  RecommendationTrainingSnapshotModel,
);

RecommendationTrainingSnapshotSchema.index({ docKey: 1 }, { unique: true });
RecommendationTrainingSnapshotSchema.index({ computedAt: -1 });
