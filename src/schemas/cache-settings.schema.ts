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
}

export type CacheSettingsDocument = HydratedDocument<CacheSettingsModel>;

export const CacheSettingsSchema =
  SchemaFactory.createForClass(CacheSettingsModel);
