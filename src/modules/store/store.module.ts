import { AddressesModule } from '@modules/addresses/addresses.module';
import { CartModule } from '@modules/cart/cart.module';
import { MediasModule } from '@modules/medias/medias.module';
import { OffersModule } from '@modules/offers/offers.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { ProductsModule } from '@modules/products/products.module';
import { RatingsModule } from '@modules/ratings/ratings.module';
import { DrinksModule } from '@modules/drinks/drinks.module';
import { ProductBundlesModule } from '@modules/product-bundles/product-bundles.module';
import { StockItemsModule } from '@modules/stock-items/stock-items.module';
import { CatalogLibraryModule } from '@modules/catalog-library/catalog-library.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { BillingModule } from '@modules/billing/billing.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { BusinessTypesModule } from '@modules/business-types/business-types.module';
import { AuthModule } from '@modules/auth/auth.module';
import { DashboardAuditModule } from '@modules/dashboard-audit/dashboard-audit.module';
import { PublicSeoModule } from '@modules/public-seo/public-seo.module';
import { GraphModule } from '@modules/graph/graph.module';
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
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import {
  ProductBundleModel,
  ProductBundleSchema,
} from '@schemas/product-bundle.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  VendorStripeResetOrderArchiveModel,
  VendorStripeResetOrderArchiveSchema,
} from '@schemas/vendor-stripe-reset-order-archive.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import {
  VendorSubscriptionModel,
  VendorSubscriptionSchema,
} from '@schemas/vendor-subscription.schema';
import { DailyMenuReminderCron } from './daily-menu-reminder.cron';
import { DailyMenuReminderService } from './daily-menu-reminder.service';
import { InternalSecretGuard } from '@modules/notifications/guards/internal-secret.guard';
import { InternalInboxController } from './internal-inbox.controller';
import { StoreController } from './store.controller';
import { StoreLaunchNotifierService } from './store-launch-notifier.service';
import { StoreRegionBackfillService } from './store-region-backfill.service';
import { StoreService } from './store.service';
import { StoreDeliveryDriversModule } from '@modules/store-delivery-drivers/store-delivery-drivers.module';
import { StoreSubscribersModule } from '@modules/store-subscribers/store-subscribers.module';

@Module({
  controllers: [StoreController, InternalInboxController],
  providers: [
    InternalSecretGuard,
    StoreService,
    StoreLaunchNotifierService,
    DailyMenuReminderService,
    DailyMenuReminderCron,
    StoreRegionBackfillService,
  ],
  imports: [
    GraphModule,
    AuthModule,
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
    BusinessTypesModule,
    DashboardAuditModule,
    PublicSeoModule,
    CartModule,
    OrdersModule,
    StockItemsModule,
    CatalogLibraryModule,
    DrinksModule,
    // Stock catalogue bundles (quantite/seuil) consommé au checkout.
    ProductBundlesModule,
    forwardRef(() => BillingModule),
    VendorStatusEmailModule,
    StoreDeliveryDriversModule,
    StoreSubscribersModule,
    MongooseModule.forFeature([
      { name: AppNotificationModel.name, schema: AppNotificationSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: ProductBundleModel.name, schema: ProductBundleSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: VendorStripeResetOrderArchiveModel.name,
        schema: VendorStripeResetOrderArchiveSchema,
      },
      { name: AddressModel.name, schema: AddressSchema },
      {
        name: VendorSubscriptionModel.name,
        schema: VendorSubscriptionSchema,
      },
    ]),
  ],
  exports: [StoreService, StoreLaunchNotifierService, MongooseModule],
})
export class StoreModule {}
