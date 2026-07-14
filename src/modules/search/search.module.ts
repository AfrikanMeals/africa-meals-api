import { AddressesModule } from '@modules/addresses/addresses.module';
import { OffersModule } from '@modules/offers/offers.module';
import { ProductsModule } from '@modules/products/products.module';
import { StoreModule } from '@modules/store/store.module';
import { DrinksModule } from '@modules/drinks/drinks.module';
import { SearchSettingsModule } from '@modules/search-settings/search-settings.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { ElasticsearchModule } from '@modules/elasticsearch/elasticsearch.module';
import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
  imports: [
    AddressesModule,
    ProductsModule,
    StoreModule,
    OffersModule,
    DrinksModule,
    SearchSettingsModule,
    SupportedCountriesModule,
    SubscriptionsModule,
    ElasticsearchModule,
  ],
  exports: [SearchService],
})
export class SearchModule {}
