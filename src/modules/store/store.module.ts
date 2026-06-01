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
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { BillingModule } from '@modules/billing/billing.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AppNotificationModel,
  AppNotificationSchema,
} from '@schemas/app-notification.schema';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import {
  VendorSubscriptionModel,
  VendorSubscriptionSchema,
} from '@schemas/vendor-subscription.schema';
import { DailyMenuReminderCron } from './daily-menu-reminder.cron';
import { DailyMenuReminderService } from './daily-menu-reminder.service';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  controllers: [StoreController],
  providers: [StoreService, DailyMenuReminderService, DailyMenuReminderCron],
  imports: [
    NotificationsModule,
    WsNotifyModule,
    MailerModule,
    RatingsModule,
    AddressesModule,
    MediasModule,
    ProductsModule,
    // SharedModule,
    UsersModule,
    TeamsModule,
    SupportedCountriesModule,
    OffersModule,
    SubscriptionsModule,
    CartModule,
    OrdersModule,
    StockItemsModule,
    DrinksModule,
    forwardRef(() => BillingModule),
    MongooseModule.forFeature([
      { name: AppNotificationModel.name, schema: AppNotificationSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: AddressModel.name, schema: AddressSchema },
      {
        name: VendorSubscriptionModel.name,
        schema: VendorSubscriptionSchema,
      },
    ]),
  ],
  exports: [StoreService, MongooseModule],
})
export class StoreModule {}
