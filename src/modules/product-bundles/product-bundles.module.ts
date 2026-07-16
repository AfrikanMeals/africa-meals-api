import { AuthModule } from '@modules/auth/auth.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductBundleModel,
  ProductBundleSchema,
} from '@schemas/product-bundle.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { ProductBundlesFeedController } from './product-bundles-feed.controller';
import { ProductBundlesService } from './product-bundles.service';
import { StoreProductBundlesController } from './store-product-bundles.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: ProductBundleModel.name, schema: ProductBundleSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [ProductBundlesFeedController, StoreProductBundlesController],
  providers: [ProductBundlesService],
  exports: [ProductBundlesService],
})
export class ProductBundlesModule {}
