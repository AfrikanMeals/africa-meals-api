import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EsCatalogEntityType = 'store' | 'product' | 'drink';

export type EsCatalogDocument = {
  entityType: EsCatalogEntityType;
  entityId: string;
  storeId?: string | null;
  title: string;
  searchText: string;
  updatedAt?: string;
};

/**
 * Client HTTP Elasticsearch / OpenSearch (REST API compatible).
 * Pas de SDK lourd : fonctionne avec ES 7/8 et OpenSearch 2.x.
 */
@Injectable()
export class ElasticsearchClient {
  private readonly logger = new Logger(ElasticsearchClient.name);

  constructor(private readonly _config: ConfigService) {}

  baseUrl(): string {
    const raw =
      this._config.get<string>('ELASTICSEARCH_URL')?.trim() ||
      process.env.ELASTICSEARCH_URL?.trim() ||
      this._config.get<string>('OPENSEARCH_URL')?.trim() ||
      process.env.OPENSEARCH_URL?.trim() ||
      '';
    return raw.replace(/\/+$/, '');
  }

  catalogIndex(): string {
    return (
      this._config.get<string>('ELASTICSEARCH_CATALOG_INDEX')?.trim() ||
      process.env.ELASTICSEARCH_CATALOG_INDEX?.trim() ||
      'wise-eat-catalog'
    );
  }

  isConfigured(): boolean {
    return this.baseUrl().length > 0;
  }

  private authHeader(): Record<string, string> {
    const user =
      this._config.get<string>('ELASTICSEARCH_USERNAME')?.trim() ||
      process.env.ELASTICSEARCH_USERNAME?.trim() ||
      '';
    const pass =
      this._config.get<string>('ELASTICSEARCH_PASSWORD')?.trim() ||
      process.env.ELASTICSEARCH_PASSWORD?.trim() ||
      '';
    if (!user) return {};
    const token = Buffer.from(`${user}:${pass}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const base = this.baseUrl();
    if (!base) throw new Error('ELASTICSEARCH_URL non configuré');
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.authHeader(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`ES non-JSON HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const errMsg =
        typeof json === 'object' && json && 'error' in json
          ? JSON.stringify((json as { error: unknown }).error).slice(0, 300)
          : text.slice(0, 300);
      throw new Error(`ES HTTP ${res.status}: ${errMsg}`);
    }
    return json as T;
  }

  async ping(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      await this.request('GET', '/');
      return true;
    } catch (e) {
      this.logger.debug(
        `ES ping failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }

  async ensureCatalogIndex(): Promise<void> {
    const index = this.catalogIndex();
    try {
      await this.request('HEAD', `/${index}`);
      return;
    } catch {
      // create
    }
    await this.request('PUT', `/${index}`, {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          analyzer: {
            wise_eat_fr: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'asciifolding'],
            },
          },
        },
      },
      mappings: {
        properties: {
          entityType: { type: 'keyword' },
          entityId: { type: 'keyword' },
          storeId: { type: 'keyword' },
          title: {
            type: 'text',
            analyzer: 'wise_eat_fr',
            fields: { keyword: { type: 'keyword', ignore_above: 256 } },
          },
          searchText: { type: 'text', analyzer: 'wise_eat_fr' },
          updatedAt: { type: 'date' },
        },
      },
    });
  }
}
