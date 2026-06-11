import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
    ]),
  ],
  controllers: [PublicSeoController],
  providers: [PublicSeoService, SitemapDispatchService],
  exports: [PublicSeoService, SitemapDispatchService],
})
export class PublicSeoModule {}
