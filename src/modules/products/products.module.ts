import { MediasModule } from '@modules/medias/medias.module';
import { RatingsModule } from '@modules/ratings/ratings.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductCategoryModel,
  ProductCategorySchema,
} from '@schemas/product-category.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { ProductCategoryController } from './product-category.controller';
import { ProductCategoryService } from './product-category.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    MediasModule,
    RatingsModule,
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductCategoryModel.name, schema: ProductCategorySchema },
    ]),
  ],
  controllers: [ProductsController, ProductCategoryController],
  providers: [ProductsService, ProductCategoryService],
  exports: [ProductsService],
})
export class ProductsModule {}
