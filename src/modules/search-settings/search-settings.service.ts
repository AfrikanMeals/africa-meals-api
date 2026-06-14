import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  SearchIndexEntryDocument,
  SearchIndexEntryModel,
} from '@schemas/search-index-entry.schema';
import {
  SearchSettingsDocument,
  SearchSettingsModel,
  EmbeddingProviderEnum,
} from '@schemas/search-settings.schema';
import { DrinkModel, DrinkStatutEnum } from '@schemas/drink.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 45_000;

export type RecommendationScoreWeights = {
  perLike: number;
  perRating: number;
  recencyDivisor: number;
  favProduct: number;
  favStore: number;
  viewedStore: number;
  viewedProduct: number;
  favCategory: number;
  ratedProduct: number;
  digestProduct: number;
  digestStore: number;
  trendProductMax: number;
  trendProductDecay: number;
  searchDigestMatch: number;
  searchGlobalMatch: number;
  subscribedStore: number;
  vendorPlanSortOrder: number;
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function envNum(key: string, def: number, min = 0): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v >= min ? v : def;
}

function pickWeight(
  stored: number | null | undefined,
  envKey: string,
  def: number,
): number {
  if (stored != null && Number.isFinite(stored) && stored >= 0) {
    return stored;
  }
  return envNum(envKey, def);
}

function normalizeSearchText(parts: ReadonlyArray<unknown>): string {
  return parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
}

function hashSource(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function maskSecret(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

type ResolvedEmbeddingConfig = {
  provider: EmbeddingProviderEnum;
  apiKey: string;
  baseUrl: string;
  model: string;
  keySource: 'database' | 'env_openai' | 'env_search' | 'none';
};

@Injectable()
export class SearchSettingsService {
  private readonly _logger = new Logger(SearchSettingsService.name);
  private _cache: { at: number; doc: SearchSettingsModel } | null = null;

  constructor(
    @InjectModel(SearchSettingsModel.name)
    private readonly _settings: Model<SearchSettingsDocument>,
    private readonly _config: ConfigService,
  ) {}

  private async _getDoc(): Promise<SearchSettingsModel> {
    const now = Date.now();
    if (this._cache && now - this._cache.at < CACHE_TTL_MS) {
      return this._cache.doc;
    }
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            regexSearchEnabled: true,
            vectorSearchEnabled: false,
            vectorIndexName: 'search_vector_index',
            embeddingModel: 'text-embedding-3-small',
            embeddingProvider: EmbeddingProviderEnum.OPENAI,
            embeddingBaseUrl: '',
            embeddingApiKey: '',
            minQueryLength: 2,
            defaultMaxDistanceKm: 30,
            searchProductsEnabled: true,
            searchStoresEnabled: true,
            searchDrinksEnabled: true,
            searchOffersEnabled: true,
            reindexCronEnabled: true,
            reindexCronExpression: '0 4 * * *',
            trainingCronEnabled: true,
            trainingLookbackDays: 30,
            digestLookbackDays: 14,
            lastReindexStatus: 'idle',
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    const typed = doc as SearchSettingsModel;
    this._cache = { at: now, doc: typed };
    return typed;
  }

  invalidateCache(): void {
    this._cache = null;
  }

  private async _getDocWithSecrets(): Promise<SearchSettingsModel> {
    const doc = await this._settings
      .findOne({ key: SETTINGS_KEY })
      .select('+embeddingApiKey')
      .lean()
      .exec();
    if (doc) {
      return doc as SearchSettingsModel;
    }
    return this._getDoc();
  }

  private _normalizeEmbeddingProvider(
    value?: string | null,
  ): EmbeddingProviderEnum {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === EmbeddingProviderEnum.OLLAMA) {
      return EmbeddingProviderEnum.OLLAMA;
    }
    if (raw === EmbeddingProviderEnum.OPENAI_COMPATIBLE) {
      return EmbeddingProviderEnum.OPENAI_COMPATIBLE;
    }
    return EmbeddingProviderEnum.OPENAI;
  }

  resolveEmbeddingConfig(
    doc?: SearchSettingsModel | null,
    modelOverride?: string,
  ): ResolvedEmbeddingConfig {
    const d = doc ?? ({} as SearchSettingsModel);
    const provider = this._normalizeEmbeddingProvider(d.embeddingProvider);
    const storedKey = String(d.embeddingApiKey ?? '').trim();
    const envOpenAi = this._config.get<string>('OPENAI_API_KEY')?.trim() ?? '';
    const envSearch =
      this._config.get<string>('SEARCH_EMBEDDING_API_KEY')?.trim() ?? '';

    let apiKey = '';
    let keySource: ResolvedEmbeddingConfig['keySource'] = 'none';
    if (storedKey) {
      apiKey = storedKey;
      keySource = 'database';
    } else if (envOpenAi) {
      apiKey = envOpenAi;
      keySource = 'env_openai';
    } else if (envSearch) {
      apiKey = envSearch;
      keySource = 'env_search';
    }

    const storedBase = String(d.embeddingBaseUrl ?? '').trim();
    let baseUrl = storedBase;
    if (!baseUrl) {
      if (provider === EmbeddingProviderEnum.OLLAMA) {
        baseUrl =
          this._config.get<string>('OLLAMA_BASE_URL')?.trim() ||
          'http://127.0.0.1:11434';
      } else {
        baseUrl =
          this._config.get<string>('OPENAI_BASE_URL')?.trim() ||
          'https://api.openai.com/v1';
      }
    }

    const defaultModel =
      provider === EmbeddingProviderEnum.OLLAMA
        ? 'nomic-embed-text'
        : 'text-embedding-3-small';
    const model = String(modelOverride ?? d.embeddingModel ?? defaultModel).trim();

    return { provider, apiKey, baseUrl, model, keySource };
  }

  async isEmbeddingApiConfigured(): Promise<boolean> {
    const doc = await this._getDocWithSecrets();
    const cfg = this.resolveEmbeddingConfig(doc);
    if (cfg.provider === EmbeddingProviderEnum.OLLAMA) {
      return Boolean(cfg.baseUrl.trim());
    }
    return Boolean(cfg.apiKey);
  }

  async embedText(text: string, model?: string): Promise<number[]> {
    const doc = await this._getDocWithSecrets();
    const cfg = this.resolveEmbeddingConfig(doc, model);
    const trimmed = text.trim();
    if (!trimmed) return [];

    if (
      cfg.provider !== EmbeddingProviderEnum.OLLAMA &&
      !cfg.apiKey
    ) {
      return [];
    }

    try {
      if (cfg.provider === EmbeddingProviderEnum.OLLAMA) {
        return await this._embedViaOllama(trimmed, cfg);
      }
      return await this._embedViaOpenAiCompatible(trimmed, cfg);
    } catch (e) {
      this._logger.warn(
        `Embedding failed (${cfg.provider}): ${(e as Error).message}`,
      );
      return [];
    }
  }

  private async _embedViaOpenAiCompatible(
    text: string,
    cfg: ResolvedEmbeddingConfig,
  ): Promise<number[]> {
    const root = cfg.baseUrl.replace(/\/$/, '');
    const url = root.endsWith('/v1')
      ? `${root}/embeddings`
      : `${root}/v1/embeddings`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model || 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this._logger.warn(`Embedding API ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = json.data?.[0]?.embedding;
    return Array.isArray(vector) ? vector : [];
  }

  private async _embedViaOllama(
    text: string,
    cfg: ResolvedEmbeddingConfig,
  ): Promise<number[]> {
    const root = cfg.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '');
    const url = `${root}/api/embeddings`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: cfg.model || 'nomic-embed-text',
        prompt: text.slice(0, 8000),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this._logger.warn(`Ollama embeddings ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }
    const json = (await res.json()) as {
      embedding?: number[];
      data?: Array<{ embedding?: number[] }>;
    };
    if (Array.isArray(json.embedding)) {
      return json.embedding;
    }
    const nested = json.data?.[0]?.embedding;
    return Array.isArray(nested) ? nested : [];
  }

  private _credentialsResponse(doc: SearchSettingsModel) {
    const storedKey = String(doc.embeddingApiKey ?? '').trim();
    const envOpenAi = Boolean(
      this._config.get<string>('OPENAI_API_KEY')?.trim(),
    );
    const envSearch = Boolean(
      this._config.get<string>('SEARCH_EMBEDDING_API_KEY')?.trim(),
    );
    const cfg = this.resolveEmbeddingConfig(doc);
    return {
      embeddingApiKeySource: cfg.keySource,
      embeddingApiKeyPreview: storedKey ? maskSecret(storedKey) : null,
      openAiEnvConfigured: envOpenAi,
      searchEmbeddingEnvConfigured: envSearch,
      ollamaBaseUrlEnvConfigured: Boolean(
        this._config.get<string>('OLLAMA_BASE_URL')?.trim(),
      ),
      embeddingConfigured: cfg.provider === EmbeddingProviderEnum.OLLAMA
        ? Boolean(cfg.baseUrl.trim())
        : Boolean(cfg.apiKey),
    };
  }

  private _toResponse(doc: SearchSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      search: {
        regexSearchEnabled: doc.regexSearchEnabled !== false,
        vectorSearchEnabled: doc.vectorSearchEnabled === true,
        vectorIndexName: String(doc.vectorIndexName ?? 'search_vector_index'),
        embeddingModel: String(doc.embeddingModel ?? 'text-embedding-3-small'),
        embeddingProvider: this._normalizeEmbeddingProvider(doc.embeddingProvider),
        embeddingBaseUrl: String(doc.embeddingBaseUrl ?? ''),
        minQueryLength: Math.max(1, Number(doc.minQueryLength ?? 2)),
        defaultMaxDistanceKm: Math.min(
          100,
          Math.max(1, Number(doc.defaultMaxDistanceKm ?? 30)),
        ),
        productsEnabled: doc.searchProductsEnabled !== false,
        storesEnabled: doc.searchStoresEnabled !== false,
        drinksEnabled: doc.searchDrinksEnabled !== false,
        offersEnabled: doc.searchOffersEnabled !== false,
      },
      credentials: this._credentialsResponse(doc),
      reindex: {
        cronEnabled: doc.reindexCronEnabled !== false,
        cronExpression: String(doc.reindexCronExpression ?? '0 4 * * *'),
        lastStatus: String(doc.lastReindexStatus ?? 'idle'),
        lastAt:
          doc.lastReindexAt instanceof Date
            ? doc.lastReindexAt.toISOString()
            : doc.lastReindexAt
            ? new Date(String(doc.lastReindexAt)).toISOString()
            : null,
        lastMessage: String(doc.lastReindexMessage ?? ''),
        lastProducts: Number(doc.lastReindexProducts ?? 0),
        lastStores: Number(doc.lastReindexStores ?? 0),
        lastDrinks: Number(doc.lastReindexDrinks ?? 0),
        lastEmbeddings: Number(doc.lastReindexEmbeddings ?? 0),
      },
      recommendations: {
        trainingCronEnabled: doc.trainingCronEnabled !== false,
        trainingLookbackDays: Math.max(
          1,
          Number(doc.trainingLookbackDays ?? 30),
        ),
        digestLookbackDays: Math.max(1, Number(doc.digestLookbackDays ?? 14)),
        weights: this.buildRecommendationWeights(doc),
      },
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  buildRecommendationWeights(
    doc?: SearchSettingsModel | null,
  ): RecommendationScoreWeights {
    const d = doc ?? ({} as SearchSettingsModel);
    return {
      perLike: pickWeight(d.recoPerLike, 'RECO_SCORE_PER_LIKE', 0.12),
      perRating: pickWeight(d.recoPerRating, 'RECO_SCORE_PER_RATING', 2.8),
      recencyDivisor: Math.max(
        1,
        envNum('RECO_SCORE_RECENCY_DIVISOR', 400, 1),
      ),
      favProduct: pickWeight(d.recoFavProduct, 'RECO_WEIGHT_FAV_PRODUCT', 85),
      favStore: pickWeight(d.recoFavStore, 'RECO_WEIGHT_FAV_STORE', 42),
      viewedStore: pickWeight(
        d.recoViewedStore,
        'RECO_WEIGHT_VIEWED_STORE',
        28,
      ),
      viewedProduct: pickWeight(
        d.recoViewedProduct,
        'RECO_WEIGHT_VIEWED_PRODUCT',
        22,
      ),
      favCategory: envNum('RECO_WEIGHT_FAV_CATEGORY', 24),
      ratedProduct: envNum('RECO_WEIGHT_RATED_PRODUCT', 32),
      digestProduct: envNum('RECO_WEIGHT_DIGEST_PRODUCT', 14),
      digestStore: envNum('RECO_WEIGHT_DIGEST_STORE', 18),
      trendProductMax: pickWeight(
        d.recoTrendProductMax,
        'RECO_TREND_PRODUCT_BOOST_MAX',
        38,
      ),
      trendProductDecay: envNum('RECO_TREND_PRODUCT_BOOST_DECAY', 0.15),
      searchDigestMatch: envNum('RECO_WEIGHT_SEARCH_DIGEST', 6),
      searchGlobalMatch: envNum('RECO_WEIGHT_SEARCH_GLOBAL', 3),
      subscribedStore: pickWeight(
        d.recoSubscribedStore,
        'RECO_WEIGHT_SUBSCRIBED_STORE',
        58,
      ),
      vendorPlanSortOrder: pickWeight(
        d.recoVendorPlanSortOrder,
        'RECO_WEIGHT_VENDOR_PLAN_SORT',
        16,
      ),
    };
  }

  async getPublicSettings() {
    const doc = await this._getDocWithSecrets();
    return this._toResponse(doc);
  }

  async getRecommendationWeights(): Promise<RecommendationScoreWeights> {
    const doc = await this._getDoc();
    return this.buildRecommendationWeights(doc);
  }

  async getSearchRuntimeConfig() {
    const doc = await this._getDoc();
    return {
      regexSearchEnabled: doc.regexSearchEnabled !== false,
      vectorSearchEnabled: doc.vectorSearchEnabled === true,
      vectorIndexName: String(doc.vectorIndexName ?? 'search_vector_index'),
      minQueryLength: Math.max(1, Number(doc.minQueryLength ?? 2)),
      defaultMaxDistanceKm: Math.min(
        100,
        Math.max(1, Number(doc.defaultMaxDistanceKm ?? 30)),
      ),
      searchProductsEnabled: doc.searchProductsEnabled !== false,
      searchStoresEnabled: doc.searchStoresEnabled !== false,
      searchDrinksEnabled: doc.searchDrinksEnabled !== false,
      searchOffersEnabled: doc.searchOffersEnabled !== false,
      trainingLookbackDays: Math.max(
        1,
        Number(doc.trainingLookbackDays ?? 30),
      ),
      digestLookbackDays: Math.max(1, Number(doc.digestLookbackDays ?? 14)),
      trainingCronEnabled: doc.trainingCronEnabled !== false,
      reindexCronEnabled: doc.reindexCronEnabled !== false,
      reindexCronExpression: String(doc.reindexCronExpression ?? '0 4 * * *'),
    };
  }

  async updateSettings(user: UserModel, dto: import('./dto/update-search-settings.dto').UpdateSearchSettingsDto) {
    assertAdmin(user);
    if (!dto.regexSearchEnabled && !dto.vectorSearchEnabled) {
      throw new BadRequestException('at_least_one_search_mode_required');
    }

    const patch: Record<string, unknown> = {
      regexSearchEnabled: dto.regexSearchEnabled,
      vectorSearchEnabled: dto.vectorSearchEnabled,
      vectorIndexName: dto.vectorIndexName.trim(),
      embeddingModel: dto.embeddingModel.trim(),
      embeddingProvider: this._normalizeEmbeddingProvider(dto.embeddingProvider),
      embeddingBaseUrl: String(dto.embeddingBaseUrl ?? '').trim(),
      minQueryLength: dto.minQueryLength,
      defaultMaxDistanceKm: dto.defaultMaxDistanceKm,
      searchProductsEnabled: dto.searchProductsEnabled,
      searchStoresEnabled: dto.searchStoresEnabled,
      searchDrinksEnabled: dto.searchDrinksEnabled,
      searchOffersEnabled: dto.searchOffersEnabled,
      reindexCronEnabled: dto.reindexCronEnabled,
      reindexCronExpression: dto.reindexCronExpression.trim(),
      trainingCronEnabled: dto.trainingCronEnabled,
      trainingLookbackDays: dto.trainingLookbackDays,
      digestLookbackDays: dto.digestLookbackDays,
    };

    const weightFields: Array<{
      patchKey: keyof SearchSettingsModel;
      dtoKey: keyof import('./dto/update-search-settings.dto').UpdateSearchSettingsDto;
    }> = [
      { patchKey: 'recoPerLike', dtoKey: 'recoPerLike' },
      { patchKey: 'recoPerRating', dtoKey: 'recoPerRating' },
      { patchKey: 'recoFavProduct', dtoKey: 'recoFavProduct' },
      { patchKey: 'recoFavStore', dtoKey: 'recoFavStore' },
      { patchKey: 'recoViewedStore', dtoKey: 'recoViewedStore' },
      { patchKey: 'recoViewedProduct', dtoKey: 'recoViewedProduct' },
      { patchKey: 'recoSubscribedStore', dtoKey: 'recoSubscribedStore' },
      { patchKey: 'recoVendorPlanSortOrder', dtoKey: 'recoVendorPlanSortOrder' },
      { patchKey: 'recoTrendProductMax', dtoKey: 'recoTrendProductMax' },
    ];
    for (const { patchKey, dtoKey } of weightFields) {
      const raw = dto[dtoKey];
      patch[patchKey] =
        raw == null || raw === ('' as unknown)
          ? null
          : Math.max(0, Number(raw));
    }

    if (dto.embeddingApiKey !== undefined) {
      patch.embeddingApiKey = dto.embeddingApiKey.trim();
    }

    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .select('+embeddingApiKey')
      .exec();
    this.invalidateCache();
    return this._toResponse(updated);
  }

  async markReindexRunning(): Promise<void> {
    await this._settings
      .updateOne(
        { key: SETTINGS_KEY },
        {
          $set: {
            lastReindexStatus: 'running',
            lastReindexMessage: 'Ré-indexation en cours…',
          },
        },
      )
      .exec();
    this.invalidateCache();
  }

  async markReindexResult(result: {
    status: 'success' | 'failed';
    message: string;
    products: number;
    stores: number;
    drinks: number;
    embeddings: number;
  }): Promise<void> {
    await this._settings
      .updateOne(
        { key: SETTINGS_KEY },
        {
          $set: {
            lastReindexStatus: result.status,
            lastReindexAt: new Date(),
            lastReindexMessage: result.message,
            lastReindexProducts: result.products,
            lastReindexStores: result.stores,
            lastReindexDrinks: result.drinks,
            lastReindexEmbeddings: result.embeddings,
          },
        },
      )
      .exec();
    this.invalidateCache();
  }
}

@Injectable()
export class SearchVectorReindexService {
  private readonly _logger = new Logger(SearchVectorReindexService.name);
  private _running = false;

  constructor(
    @InjectModel(SearchIndexEntryModel.name)
    private readonly _indexModel: Model<SearchIndexEntryDocument>,
    @InjectModel(ProductModel.name)
    private readonly _productModel: Model<ProductModel>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    @InjectModel(DrinkModel.name)
    private readonly _drinkModel: Model<DrinkModel>,
    private readonly _settings: SearchSettingsService,
  ) {}

  isRunning(): boolean {
    return this._running;
  }

  async runReindex(opts?: { forceEmbeddings?: boolean }): Promise<{
    products: number;
    stores: number;
    drinks: number;
    embeddings: number;
    message: string;
  }> {
    if (this._running) {
      throw new BadRequestException('reindex_already_running');
    }
    this._running = true;
    await this._settings.markReindexRunning();

    let products = 0;
    let stores = 0;
    let drinks = 0;
    let embeddings = 0;

    try {
      const runtime = await this._settings.getSearchRuntimeConfig();
      const settingsDoc = await this._settings.getPublicSettings();
      const wantEmbeddings =
        (opts?.forceEmbeddings ?? false) || settingsDoc.search.vectorSearchEnabled;
      const canEmbed = wantEmbeddings && (await this._settings.isEmbeddingApiConfigured());

      const storeRows = await this._storeModel
        .find({ status: StoreStatusEnum.ACTIVE })
        .select('name bio about')
        .lean()
        .exec();
      for (const row of storeRows as Record<string, unknown>[]) {
        const entityId = new Types.ObjectId(String(row._id));
        const title = String(row.name ?? '');
        const searchText = normalizeSearchText([
          title,
          String(row.bio ?? ''),
          String(row.about ?? ''),
        ]);
        const sourceHash = hashSource(searchText);
        const existing = await this._indexModel
          .findOne({ entityType: 'store', entityId })
          .select('sourceHash embedding')
          .lean()
          .exec();
        const patch: Record<string, unknown> = {
          entityType: 'store',
          entityId,
          storeId: entityId,
          title,
          searchText,
          sourceHash,
        };
        if (
          canEmbed &&
          (!existing ||
            existing.sourceHash !== sourceHash ||
            !Array.isArray(existing.embedding) ||
            !existing.embedding.length)
        ) {
          const vector = await this._settings.embedText(
            searchText,
            settingsDoc.search.embeddingModel,
          );
          if (vector.length) {
            patch.embedding = vector;
            patch.embeddedAt = new Date();
            embeddings += 1;
          }
        }
        await this._indexModel.updateOne(
          { entityType: 'store', entityId },
          { $set: patch },
          { upsert: true },
        );
        stores += 1;
      }

      const productRows = await this._productModel
        .find({ status: ProductStatusEnum.ACTIVE })
        .populate('store', 'name')
        .select('title bio about store category')
        .lean()
        .exec();
      for (const row of productRows as Record<string, unknown>[]) {
        const entityId = new Types.ObjectId(String(row._id));
        const store = row.store as Record<string, unknown> | null;
        const storeId = store?._id
          ? new Types.ObjectId(String(store._id))
          : null;
        const title = String(row.title ?? '');
        const searchText = normalizeSearchText([
          title,
          String(row.bio ?? ''),
          String(row.about ?? ''),
          String(store?.name ?? ''),
        ]);
        const sourceHash = hashSource(searchText);
        const existing = await this._indexModel
          .findOne({ entityType: 'product', entityId })
          .select('sourceHash embedding')
          .lean()
          .exec();
        const patch: Record<string, unknown> = {
          entityType: 'product',
          entityId,
          storeId,
          title,
          searchText,
          sourceHash,
        };
        if (
          canEmbed &&
          (!existing ||
            existing.sourceHash !== sourceHash ||
            !Array.isArray(existing.embedding) ||
            !existing.embedding.length)
        ) {
          const vector = await this._settings.embedText(
            searchText,
            settingsDoc.search.embeddingModel,
          );
          if (vector.length) {
            patch.embedding = vector;
            patch.embeddedAt = new Date();
            embeddings += 1;
          }
        }
        await this._indexModel.updateOne(
          { entityType: 'product', entityId },
          { $set: patch },
          { upsert: true },
        );
        products += 1;
      }

      const drinkRows = await this._drinkModel
        .find({ statut: DrinkStatutEnum.OK, quantite: { $gt: 0 } })
        .populate('store', 'name')
        .select('name description store')
        .lean()
        .exec();
      for (const row of drinkRows as Record<string, unknown>[]) {
        const entityId = new Types.ObjectId(String(row._id));
        const store = row.store as Record<string, unknown> | null;
        const storeId = store?._id
          ? new Types.ObjectId(String(store._id))
          : null;
        const title = String(row.name ?? '');
        const searchText = normalizeSearchText([
          title,
          String(row.description ?? ''),
          String(store?.name ?? ''),
        ]);
        const sourceHash = hashSource(searchText);
        await this._indexModel.updateOne(
          { entityType: 'drink', entityId },
          {
            $set: {
              entityType: 'drink',
              entityId,
              storeId,
              title,
              searchText,
              sourceHash,
            },
          },
          { upsert: true },
        );
        drinks += 1;
      }

      const providerLabel =
        settingsDoc.search.embeddingProvider === 'ollama'
          ? 'Ollama/Llama'
          : 'OpenAI';
      const msg = canEmbed
        ? `Index mis à jour (${products} plats, ${stores} boutiques, ${drinks} boissons, ${embeddings} embeddings via ${providerLabel}).`
        : `Index texte mis à jour (${products} plats, ${stores} boutiques, ${drinks} boissons). Embeddings ignorés — configurez une clé API (admin ou OPENAI_API_KEY / SEARCH_EMBEDDING_API_KEY) ou Ollama (OLLAMA_BASE_URL).`;

      await this._settings.markReindexResult({
        status: 'success',
        message: msg,
        products,
        stores,
        drinks,
        embeddings,
      });

      return { products, stores, drinks, embeddings, message: msg };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Ré-indexation impossible.';
      await this._settings.markReindexResult({
        status: 'failed',
        message,
        products,
        stores,
        drinks,
        embeddings,
      });
      throw e;
    } finally {
      this._running = false;
    }
  }
}
