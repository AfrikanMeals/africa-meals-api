import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SearchIndexEntryModel,
  SearchIndexEntrySchema,
} from '@schemas/search-index-entry.schema';
import {
  SearchSettingsModel,
  SearchSettingsSchema,
} from '@schemas/search-settings.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { SearchSettingsController } from './search-settings.controller';
import {
  SearchSettingsService,
  SearchVectorReindexService,
} from './search-settings.service';
import { SearchReindexProgressService } from './search-reindex-progress.service';
import { SearchVectorReindexCron } from './search-vector-reindex.cron';
import { ElasticsearchModule } from '@modules/elasticsearch/elasticsearch.module';

@Module({
  imports: [
    ElasticsearchModule,
    MongooseModule.forFeature([
      { name: SearchSettingsModel.name, schema: SearchSettingsSchema },
      { name: SearchIndexEntryModel.name, schema: SearchIndexEntrySchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
    ]),
  ],
  controllers: [SearchSettingsController],
  providers: [
    SearchSettingsService,
    SearchVectorReindexService,
    SearchReindexProgressService,
    SearchVectorReindexCron,
  ],
  exports: [
    SearchSettingsService,
    SearchVectorReindexService,
    SearchReindexProgressService,
  ],
})
export class SearchSettingsModule {}
