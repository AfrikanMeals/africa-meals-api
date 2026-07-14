import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SearchReindexStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed';

/** Fournisseur d’embeddings pour la recherche vectorielle. */
export enum EmbeddingProviderEnum {
  OPENAI = 'openai',
  /** Llama / modèles locaux via Ollama (`POST /api/embeddings`). */
  OLLAMA = 'ollama',
  /** Endpoint compatible OpenAI (`POST /v1/embeddings`). */
  OPENAI_COMPATIBLE = 'openai_compatible',
}

/** Paramètres plateforme : recherche texte, vectorielle et recommandations. */
@Schema({ timestamps: true, collection: 'search_settings' })
export class SearchSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Recherche classique MongoDB ($regex). */
  @Prop({ type: Boolean, default: true })
  regexSearchEnabled: boolean;

  /** Recherche vectorielle MongoDB Atlas ($vectorSearch). */
  @Prop({ type: Boolean, default: false })
  vectorSearchEnabled: boolean;

  /**
   * Recherche full-text Elasticsearch / OpenSearch (index catalogue).
   * Si activé : ES → IDs → hydratation Mongo (région, Stripe, etc.).
   */
  @Prop({ type: Boolean, default: false })
  elasticsearchSearchEnabled: boolean;

  @Prop({ type: String, default: 'search_vector_index' })
  vectorIndexName: string;

  @Prop({ type: String, default: 'text-embedding-3-small' })
  embeddingModel: string;

  @Prop({
    type: String,
    enum: EmbeddingProviderEnum,
    default: EmbeddingProviderEnum.OPENAI,
  })
  embeddingProvider: EmbeddingProviderEnum;

  /** URL de base (OpenAI-compatible `/v1` ou Ollama sans suffixe). */
  @Prop({ type: String, default: '' })
  embeddingBaseUrl: string;

  /** Clé API stockée en base (prioritaire sur les variables d’environnement). */
  @Prop({ type: String, default: '', select: false })
  embeddingApiKey: string;

  /** Longueur minimale d’une requête texte (caractères). */
  @Prop({ type: Number, default: 2 })
  minQueryLength: number;

  /** Rayon géo par défaut (km) si lat/lng fournis sans maxDistanceKm. */
  @Prop({ type: Number, default: 30 })
  defaultMaxDistanceKm: number;

  @Prop({ type: Boolean, default: true })
  searchProductsEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  searchStoresEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  searchDrinksEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  searchOffersEnabled: boolean;

  /** Cron de ré-indexation vectorielle activé. */
  @Prop({ type: Boolean, default: true })
  reindexCronEnabled: boolean;

  /** Expression cron (UTC) — ex. `0 4 * * *`. */
  @Prop({ type: String, default: '0 4 * * *' })
  reindexCronExpression: string;

  /** Cron entraînement recommandations activé. */
  @Prop({ type: Boolean, default: true })
  trainingCronEnabled: boolean;

  @Prop({ type: Number, default: 30 })
  trainingLookbackDays: number;

  @Prop({ type: Number, default: 14 })
  digestLookbackDays: number;

  /** Poids recommandations — `null` = fallback variables d’environnement. */
  @Prop({ type: Number, default: null })
  recoPerLike: number | null;

  @Prop({ type: Number, default: null })
  recoPerRating: number | null;

  @Prop({ type: Number, default: null })
  recoFavProduct: number | null;

  @Prop({ type: Number, default: null })
  recoFavStore: number | null;

  @Prop({ type: Number, default: null })
  recoViewedStore: number | null;

  @Prop({ type: Number, default: null })
  recoViewedProduct: number | null;

  @Prop({ type: Number, default: null })
  recoSubscribedStore: number | null;

  @Prop({ type: Number, default: null })
  recoVendorPlanSortOrder: number | null;

  /** Poids du score formule (0–100) dans recommandations et Ads. */
  @Prop({ type: Number, default: null })
  recoVendorPlanScore: number | null;

  @Prop({ type: Number, default: null })
  recoTrendProductMax: number | null;

  @Prop({ type: String, default: 'idle' })
  lastReindexStatus: SearchReindexStatus;

  @Prop({ type: Date, default: null })
  lastReindexAt: Date | null;

  @Prop({ type: String, default: '' })
  lastReindexMessage: string;

  @Prop({ type: Number, default: 0 })
  lastReindexProducts: number;

  @Prop({ type: Number, default: 0 })
  lastReindexStores: number;

  @Prop({ type: Number, default: 0 })
  lastReindexDrinks: number;

  @Prop({ type: Number, default: 0 })
  lastReindexEmbeddings: number;
}

export type SearchSettingsDocument = HydratedDocument<SearchSettingsModel>;

export const SearchSettingsSchema =
  SchemaFactory.createForClass(SearchSettingsModel);
