import { CartModule } from '@modules/cart/cart.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { ProductsModule } from '@modules/products/products.module';
import { AdsModule } from '@modules/ads/ads.module';
import { StripeConnectTransferModule } from '@modules/billing/stripe/stripe-connect-transfer.module';
import { PartnerSubscriptionsModule } from '@modules/partner-subscriptions/partner-subscriptions.module';
import { CheckoutDeliverySettingsModule } from '@modules/checkout-delivery-settings/checkout-delivery-settings.module';
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import {
  ProductCategoryModel,
  ProductCategorySchema,
} from '@schemas/product-category.schema';
import {
  OrderStatusEventModel,
  OrderStatusEventSchema,
} from '@schemas/order-status-event.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PreOrderReminderCron } from './pre-order-reminder.cron';
import { PreOrderReminderService } from './pre-order-reminder.service';
import { ProductRatingsDemoSeedService } from './product-ratings-demo-seed.service';
import { OrdersDemoSeedService } from './orders-demo-seed.service';
import { OrderStatusEventsService } from './order-status-events.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { BusinessReportsModule } from '@modules/business-reports/business-reports.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { MediasModule } from '@modules/medias/medias.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { OrderInvoicePdfService } from './order-invoice-pdf.service';
import { OrderPaidInvoiceEmailService } from './order-paid-invoice-email.service';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { VendorNotificationModule } from '@modules/vendor-notifications/vendor-notification.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { DeliveryAgentModule } from '@modules/delivery-agent/delivery-agent.module';
import { DeliveryOrderOfferModule } from '@modules/delivery-order-offer/delivery-order-offer.module';
import { DomainEventHandlersModule } from '@modules/domain-event-handlers/domain-event-handlers.module';
import { RatingsModule } from '@modules/ratings/ratings.module';
import { PendingDeliveryModule } from '@modules/pending-delivery/pending-delivery.module';
import { GraphModule } from '@modules/graph/graph.module';
import { MapSettingsModule } from '@modules/map-settings/map-settings.module';

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderStatusEventsService,
    OrdersDemoSeedService,
    ProductRatingsDemoSeedService,
    OrderInvoicePdfService,
    OrderPaidInvoiceEmailService,
    PreOrderReminderService,
    PreOrderReminderCron,
  ],
  exports: [
    OrdersService,
    OrderStatusEventsService,
    OrderPaidInvoiceEmailService,
  ],
  imports: [
    NotificationsModule,
    WsNotifyModule,
    CheckoutDeliverySettingsModule,
    forwardRef(() => TeamsModule),
    MailerModule,
    MediasModule,
    forwardRef(() => SupportedCountriesModule),
    forwardRef(() => VendorStatusEmailModule),
    forwardRef(() => VendorNotificationModule),
    BusinessReportsModule,
    CartModule,
    AdsModule,
    LoyaltyModule,
    ProductsModule,
    StripeConnectTransferModule,
    forwardRef(() => PartnerSubscriptionsModule),
    forwardRef(() => DeliveryAgentModule),
    forwardRef(() => DeliveryOrderOfferModule),
    forwardRef(() => PendingDeliveryModule),
    forwardRef(() => DomainEventHandlersModule),
    RatingsModule,
    GraphModule,
    MapSettingsModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: OrderStatusEventModel.name,
        schema: OrderStatusEventSchema,
      },
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: StoreModel.name, schema: StoreSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      { name: UserModel.name, schema: UserSchema },
      { name: AddressModel.name, schema: AddressSchema },
      {
        name: ProductCategoryModel.name,
        schema: ProductCategorySchema,
      },
    ]),
  ],
})
export class OrdersModule {}
