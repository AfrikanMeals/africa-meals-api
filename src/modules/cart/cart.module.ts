import { CouponsModule } from '@modules/coupons/coupons.module';
import { GiftCodesModule } from '@modules/gift-codes/gift-codes.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { DrinksModule } from '@modules/drinks/drinks.module';
import { OffersModule } from '@modules/offers/offers.module';
import { ProductsModule } from '@modules/products/products.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartItemModel, CartItemSchema } from '@schemas/cart_item.schema';
import {
  CartMarketingStrategyModel,
  CartMarketingStrategySchema,
} from '@schemas/cart-marketing-strategy.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  controllers: [CartController],
  providers: [CartService],
  imports: [
    ProductsModule,
    OffersModule,
    DrinksModule,
    CouponsModule,
    GiftCodesModule,
    SupportedCountriesModule,
    MongooseModule.forFeature([
      { name: CartItemModel.name, schema: CartItemSchema },
      { name: CartMarketingStrategyModel.name, schema: CartMarketingStrategySchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  exports: [CartService],
})
export class CartModule {}
