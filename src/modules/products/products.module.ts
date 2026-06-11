import { MediasModule } from '@modules/medias/medias.module';
import { PublicSeoModule } from '@modules/public-seo/public-seo.module';
import { RatingsModule } from '@modules/ratings/ratings.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductCategoryModel,
  ProductCategorySchema,
} from '@schemas/product-category.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { ProductCategoryController } from './product-category.controller';
import { ProductCategoryService } from './product-category.service';
import { ProductsController } from './products.controller';
import { ProductDiscountScheduleCron } from './product-discount-schedule.cron';
import { ProductDiscountScheduleService } from './product-discount-schedule.service';
import { ProductsService } from './products.service';

@Module({
  imports: [
    MediasModule,
    PublicSeoModule,
    RatingsModule,
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: ProductCategoryModel.name, schema: ProductCategorySchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [ProductsController, ProductCategoryController],
  providers: [
    ProductsService,
    ProductCategoryService,
    ProductDiscountScheduleService,
    ProductDiscountScheduleCron,
  ],
  exports: [ProductsService, ProductCategoryService, ProductDiscountScheduleService],
})
export class ProductsModule {}
