import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { GoogleMerchantAdminController } from './google-merchant-admin.controller';
import { GoogleMerchantController } from './google-merchant.controller';
import { GoogleMerchantService } from './google-merchant.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [GoogleMerchantController, GoogleMerchantAdminController],
  providers: [GoogleMerchantService],
})
export class GoogleMerchantModule {}
