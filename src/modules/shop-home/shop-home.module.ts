import { AdsModule } from '@modules/ads/ads.module';
import { AnnouncementsModule } from '@modules/announcements/announcements.module';
import { ProductsModule } from '@modules/products/products.module';
import { SearchModule } from '@modules/search/search.module';
import { Module } from '@nestjs/common';
import { ShopHomeService } from './shop-home.service';
import { ShopHomeWarmCron } from './shop-home-warm.cron';

@Module({
  imports: [AnnouncementsModule, AdsModule, ProductsModule, SearchModule],
  providers: [ShopHomeService, ShopHomeWarmCron],
  exports: [ShopHomeService],
})
export class ShopHomeModule {}
