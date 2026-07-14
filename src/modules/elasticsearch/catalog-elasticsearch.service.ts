import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ElasticsearchClient,
  type EsCatalogDocument,
  type EsCatalogEntityType,
} from './elasticsearch.client';

export type CatalogEsHit = {
  entityType: EsCatalogEntityType;
  entityId: string;
  score: number;
};

/**
 * Recherche catalogue boutique/produit/boisson via Elasticsearch / OpenSearch.
 * Les règles métier (région, Stripe, ACTIVE) restent en Mongo après hydratation.
 */
@Injectable()
export class CatalogElasticsearchService {
  private readonly logger = new Logger(CatalogElasticsearchService.name);
  private _indexReady = false;

  constructor(
    private readonly _es: ElasticsearchClient,
    private readonly _config: ConfigService,
  ) {}

  isEnabledByEnv(): boolean {
    const flag = String(
      this._config.get<string>('ELASTICSEARCH_SEARCH_ENABLED') ??
        process.env.ELASTICSEARCH_SEARCH_ENABLED ??
        '',
    )
      .trim()
      .toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off') return false;
    return this._es.isConfigured();
  }

  async ensureReady(): Promise<boolean> {
    if (!this._es.isConfigured()) return false;
    if (this._indexReady) return true;
    try {
      await this._es.ensureCatalogIndex();
      this._indexReady = true;
      return true;
    } catch (e) {
      this.logger.warn(
        `ES ensure index: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  async upsertDocuments(docs: EsCatalogDocument[]): Promise<number> {
    if (!docs.length || !(await this.ensureReady())) return 0;
    const index = this._es.catalogIndex();
    const lines: string[] = [];
    for (const doc of docs) {
      const id = `${doc.entityType}:${doc.entityId}`;
      lines.push(JSON.stringify({ index: { _index: index, _id: id } }));
      lines.push(
        JSON.stringify({
          entityType: doc.entityType,
          entityId: doc.entityId,
          storeId: doc.storeId ?? null,
          title: doc.title,
          searchText: doc.searchText,
          updatedAt: doc.updatedAt ?? new Date().toISOString(),
        }),
      );
    }
    const body = `${lines.join('\n')}\n`;
    const base = this._es.baseUrl();
    const user =
      this._config.get<string>('ELASTICSEARCH_USERNAME')?.trim() ||
      process.env.ELASTICSEARCH_USERNAME?.trim() ||
      '';
    const pass =
      this._config.get<string>('ELASTICSEARCH_PASSWORD')?.trim() ||
      process.env.ELASTICSEARCH_PASSWORD?.trim() ||
      '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-ndjson',
      Accept: 'application/json',
    };
    if (user) {
      headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }
    const res = await fetch(`${base}/_bulk`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`ES bulk HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    return docs.length;
  }

  /**
   * Recherche full-text fuzzy + BM25. Retourne IDs triés par score.
   */
  async searchEntityIds(params: {
    query: string;
    entityType: EsCatalogEntityType;
    limit?: number;
  }): Promise<CatalogEsHit[]> {
    const q = params.query.trim();
    if (!q || !(await this.ensureReady())) return [];
    const index = this._es.catalogIndex();
    const size = Math.min(200, Math.max(1, params.limit ?? 80));
    try {
      const result = await this._es.request<{
        hits?: {
          hits?: Array<{
            _score?: number;
            _source?: {
              entityType?: string;
              entityId?: string;
            };
          }>;
        };
      }>('POST', `/${index}/_search`, {
        size,
        query: {
          bool: {
            filter: [{ term: { entityType: params.entityType } }],
            must: [
              {
                multi_match: {
                  query: q,
                  fields: ['title^3', 'searchText'],
                  type: 'best_fields',
                  fuzziness: 'AUTO',
                  operator: 'or',
                },
              },
            ],
          },
        },
      });
      const hits = result.hits?.hits ?? [];
      const out: CatalogEsHit[] = [];
      for (const h of hits) {
        const id = h._source?.entityId;
        const type = h._source?.entityType;
        if (!id || type !== params.entityType) continue;
        out.push({
          entityType: params.entityType,
          entityId: id,
          score: Number(h._score ?? 0),
        });
      }
      return out;
    } catch (e) {
      this.logger.warn(
        `ES search failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return [];
    }
  }
}
