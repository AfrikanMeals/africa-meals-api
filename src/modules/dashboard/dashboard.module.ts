import { StoreDeliveryDriversModule } from '@modules/store-delivery-drivers/store-delivery-drivers.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import { StockItemModel, StockItemSchema } from '@schemas/stock-item.schema';
import {
  StoreRatingModel,
  StoreRatingSchema,
} from '@schemas/store_rating.schema';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import {
  DeliveryDriverModel,
  DeliveryDriverSchema,
} from '@schemas/delivery-driver.schema';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import {
  AdCreditPaymentModel,
  AdCreditPaymentSchema,
} from '@schemas/ad-credit-payment.schema';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { AdEventModel, AdEventSchema } from '@schemas/ad-event.schema';
import { AdCampaignModel, AdCampaignSchema } from '@schemas/ad-campaign.schema';
import {
  AdCampaignEventModel,
  AdCampaignEventSchema,
} from '@schemas/ad-campaign-event.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import {
  VendorFeedbackModel,
  VendorFeedbackSchema,
} from '@schemas/vendor-feedback.schema';
import {
  VendorFeatureRequestModel,
  VendorFeatureRequestSchema,
} from '@schemas/vendor-feature-request.schema';
import {
  NewsletterSubscriberModel,
  NewsletterSubscriberSchema,
} from '@schemas/newsletter-subscriber.schema';
import {
  SiteContactRequestModel,
  SiteContactRequestSchema,
} from '@schemas/site-contact-request.schema';
import { DeliveryDriversCityMigrationService } from './delivery-drivers-city-migration.service';
import { DeliveryDriversSeedService } from './delivery-drivers-seed.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { MailerModule } from '@modules/mailer/mailer.module';

@Module({
  imports: [
    NotificationsModule,
    WsNotifyModule,
    OrdersModule,
    TeamsModule,
    MailerModule,
    StoreDeliveryDriversModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreRatingModel.name, schema: StoreRatingSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StockItemModel.name, schema: StockItemSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: DeliveryDriverModel.name, schema: DeliveryDriverSchema },
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      { name: AddressModel.name, schema: AddressSchema },
      { name: AdCreditPaymentModel.name, schema: AdCreditPaymentSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdEventModel.name, schema: AdEventSchema },
      { name: AdCampaignModel.name, schema: AdCampaignSchema },
      { name: AdCampaignEventModel.name, schema: AdCampaignEventSchema },
      { name: VendorFeedbackModel.name, schema: VendorFeedbackSchema },
      {
        name: VendorFeatureRequestModel.name,
        schema: VendorFeatureRequestSchema,
      },
      {
        name: SiteContactRequestModel.name,
        schema: SiteContactRequestSchema,
      },
      {
        name: NewsletterSubscriberModel.name,
        schema: NewsletterSubscriberSchema,
      },
    ]),
  ],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DeliveryDriversSeedService,
    DeliveryDriversCityMigrationService,
  ],
  exports: [DashboardService],
})
export class DashboardModule {}
