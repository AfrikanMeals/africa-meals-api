import { Module, forwardRef } from '@nestjs/common';
import { DomainEventHandlersModule } from '@modules/domain-event-handlers/domain-event-handlers.module';
import { BillingModule } from '../billing/billing.module';
import { MongooseModule } from '@nestjs/mongoose';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { AdCampaignModel, AdCampaignSchema } from '@schemas/ad-campaign.schema';
import {
  AdNotificationEventModel,
  AdNotificationEventSchema,
} from '@schemas/ad-notification-event.schema';
import {
  AdNotificationPricingSettingsModel,
  AdNotificationPricingSettingsSchema,
} from '@schemas/ad-notification-pricing-settings.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  InfraRuntimeSettingsModel,
  InfraRuntimeSettingsSchema,
} from '@schemas/infra-runtime-settings.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { CartItemModel, CartItemSchema } from '@schemas/cart_item.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { OfferModel, OfferSchema } from '@schemas/offer.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  RecommendationTrainingSnapshotModel,
  RecommendationTrainingSnapshotSchema,
} from '@schemas/recommendation-training-snapshot.schema';
import {
  StoreCouponModel,
  StoreCouponSchema,
} from '@schemas/store_coupon.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  UserRecommendationDigestModel,
  UserRecommendationDigestSchema,
} from '@schemas/user-recommendation-digest.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { OrdersModule } from '../orders/orders.module';
import { MailerModule } from '../mailer/mailer.module';
import { SharedModule } from '../shared/shared.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TeamsModule } from '../teams/teams.module';
import { WsNotifyModule } from '../ws-notify/ws-notify.module';
import { AdminAlertEmailQueueService } from './admin-alert-email-queue.service';
import { AdminAlertEmailService } from './admin-alert-email.service';
import { DbMaintenanceAdminController } from './db-maintenance-admin.controller';
import { DbMaintenanceService } from './db-maintenance.service';
import { MapSettingsModule } from '../map-settings/map-settings.module';

@Module({
  imports: [
    TeamsModule,
    SharedModule,
    SubscriptionsModule,
    WsNotifyModule,
    MailerModule,
    OrdersModule,
    MapSettingsModule,
    forwardRef(() => BillingModule),
    DomainEventHandlersModule,
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdCampaignModel.name, schema: AdCampaignSchema },
      {
        name: AdNotificationPricingSettingsModel.name,
        schema: AdNotificationPricingSettingsSchema,
      },
      {
        name: AdNotificationEventModel.name,
        schema: AdNotificationEventSchema,
      },
      { name: StoreCouponModel.name, schema: StoreCouponSchema },
      { name: CartItemModel.name, schema: CartItemSchema },
      { name: OfferModel.name, schema: OfferSchema },
      {
        name: RecommendationTrainingSnapshotModel.name,
        schema: RecommendationTrainingSnapshotSchema,
      },
      {
        name: UserRecommendationDigestModel.name,
        schema: UserRecommendationDigestSchema,
      },
      {
        name: InfraRuntimeSettingsModel.name,
        schema: InfraRuntimeSettingsSchema,
      },
    ]),
  ],
  controllers: [DbMaintenanceAdminController],
  providers: [
    DbMaintenanceService,
    AdminAlertEmailService,
    AdminAlertEmailQueueService,
  ],
  exports: [DbMaintenanceService],
})
export class DbMaintenanceModule {}
