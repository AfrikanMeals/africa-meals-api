import { AddressesModule } from '@modules/addresses/addresses.module';
import { CartModule } from '@modules/cart/cart.module';
import { MediasModule } from '@modules/medias/medias.module';
import { OffersModule } from '@modules/offers/offers.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { ProductsModule } from '@modules/products/products.module';
import { RatingsModule } from '@modules/ratings/ratings.module';
import { DrinksModule } from '@modules/drinks/drinks.module';
import { StockItemsModule } from '@modules/stock-items/stock-items.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { UsersModule } from '@modules/users/users.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  controllers: [StoreController],
  providers: [StoreService],
  imports: [
    WsNotifyModule,
    MailerModule,
    RatingsModule,
    AddressesModule,
    MediasModule,
    ProductsModule,
    // SharedModule,
    UsersModule,
    SupportedCountriesModule,
    OffersModule,
    CartModule,
    OrdersModule,
    StockItemsModule,
    DrinksModule,
    MongooseModule.forFeature([
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
    ]),
  ],
  exports: [StoreService, MongooseModule],
})
export class StoreModule {}
