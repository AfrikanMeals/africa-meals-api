import { DEFAULT_MODULE_ENGINES } from '@common/cache/cache-engine.types';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** TTL Redis catalogue / API (singleton `key=default`), piloté depuis l’admin. */
@Schema({ timestamps: true, collection: 'cache_settings' })
export class CacheSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** TTL cache catalogue public (search, menu boutique, accueil) — ms. */
  @Prop({ type: Number, default: 90_000, min: 5_000, max: 3_600_000 })
  publicCatalogTtlMs: number;

  /** TTL listes favoris — ms. */
  @Prop({ type: Number, default: 25_000, min: 5_000, max: 600_000 })
  favoritesTtlMs: number;

  /** TTL liste publique catégories produits — ms. */
  @Prop({ type: Number, default: 120_000, min: 5_000, max: 3_600_000 })
  productCategoriesTtlMs: number;

  /** TTL cache réponses filtrées (`fields`) — ms. */
  @Prop({ type: Number, default: 120_000, min: 5_000, max: 3_600_000 })
  fieldProjectionTtlMs: number;

  /** TTL feed recommandations — ms. */
  @Prop({ type: Number, default: 45_000, min: 5_000, max: 600_000 })
  recommendationsTtlMs: number;

  /** Active le cache des réponses GET filtrées. */
  @Prop({ type: Boolean, default: true })
  fieldProjectionEnabled: boolean;

  /** Moteur cache par module applicatif. */
  @Prop({
    type: {
      publicCatalog: {
        type: String,
        enum: ['redis', 'memcached', 'memory'],
        default: DEFAULT_MODULE_ENGINES.publicCatalog,
      },
      favorites: {
        type: String,
        enum: ['redis', 'memcached', 'memory'],
        default: DEFAULT_MODULE_ENGINES.favorites,
      },
      productCategories: {
        type: String,
        enum: ['redis', 'memcached', 'memory'],
        default: DEFAULT_MODULE_ENGINES.productCategories,
      },
      checkoutPreview: {
        type: String,
        enum: ['redis', 'memcached', 'memory'],
        default: DEFAULT_MODULE_ENGINES.checkoutPreview,
      },
      fieldProjection: {
        type: String,
        enum: ['redis', 'memcached', 'memory'],
        default: DEFAULT_MODULE_ENGINES.fieldProjection,
      },
      recommendations: {
        type: String,
        enum: ['redis', 'memcached', 'memory'],
        default: DEFAULT_MODULE_ENGINES.recommendations,
      },
    },
    default: () => ({ ...DEFAULT_MODULE_ENGINES }),
  })
  moduleEngines: typeof DEFAULT_MODULE_ENGINES;
}

export type CacheSettingsDocument = HydratedDocument<CacheSettingsModel>;

export const CacheSettingsSchema =
  SchemaFactory.createForClass(CacheSettingsModel);
