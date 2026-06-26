import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { PublicSeoController } from './public-seo.controller';
import { PublicSeoService } from './public-seo.service';
import { SitemapDispatchService } from './sitemap-dispatch.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
    ]),
  ],
  controllers: [PublicSeoController],
  providers: [PublicSeoService, SitemapDispatchService],
  exports: [PublicSeoService, SitemapDispatchService],
})
export class PublicSeoModule {}
