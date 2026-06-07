import { AddressesModule } from '@modules/addresses/addresses.module';
import { OffersModule } from '@modules/offers/offers.module';
import { ProductsModule } from '@modules/products/products.module';
import { StoreModule } from '@modules/store/store.module';
import { Module } from '@nestjs/common';
import { DrinksModule } from '@modules/drinks/drinks.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  providers: [SearchService],
  imports: [AddressesModule, ProductsModule, StoreModule, OffersModule, DrinksModule],
  exports: [SearchService],
})
export class SearchModule {}
