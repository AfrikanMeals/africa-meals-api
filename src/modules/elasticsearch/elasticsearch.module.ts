import { Module } from '@nestjs/common';
import { CatalogElasticsearchService } from './catalog-elasticsearch.service';
import { ElasticsearchClient } from './elasticsearch.client';

/**
 * Recherche catalogue via Elasticsearch / OpenSearch.
 * Adresses : Pelias (ES) via pool géocode — voir `pelias-geocoding.util.ts`.
 */
@Module({
  providers: [ElasticsearchClient, CatalogElasticsearchService],
  exports: [ElasticsearchClient, CatalogElasticsearchService],
})
export class ElasticsearchModule {}
