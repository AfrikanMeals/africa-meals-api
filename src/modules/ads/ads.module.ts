import { AuthModule } from '@modules/auth/auth.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { MediasModule } from '@modules/medias/medias.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { SearchSettingsModule } from '@modules/search-settings/search-settings.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { SmsModule } from '@modules/messaging/sms.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  AdNotificationEventModel,
  AdNotificationEventSchema,
} from '@schemas/ad-notification-event.schema';
import { AdEventModel, AdEventSchema } from '@schemas/ad-event.schema';
import { AdCampaignModel, AdCampaignSchema } from '@schemas/ad-campaign.schema';
import {
  AdCampaignEventModel,
  AdCampaignEventSchema,
} from '@schemas/ad-campaign-event.schema';
import {
  AdNotificationPricingSettingsModel,
  AdNotificationPricingSettingsSchema,
} from '@schemas/ad-notification-pricing-settings.schema';
import {
  AdPricingSettingsModel,
  AdPricingSettingsSchema,
} from '@schemas/ad-pricing-settings.schema';
import {
  AdCreditPaymentModel,
  AdCreditPaymentSchema,
} from '@schemas/ad-credit-payment.schema';
import {
  StoreAdCashLedgerModel,
  StoreAdCashLedgerSchema,
} from '@schemas/store-ad-cash.schema';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  MarketingOfferListingModel,
  MarketingOfferListingSchema,
} from '@schemas/marketing-offer-listing.schema';
import {
  MarketingOfferModel,
  MarketingOfferSchema,
  MarketingOfferSectionModel,
  MarketingOfferSectionSchema,
} from '@schemas/marketing-offer.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  AdsTargetingProfileModel,
  AdsTargetingProfileSchema,
} from '@schemas/ads-targeting-profile.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { AdNotificationTrackRateLimitGuard } from './guards/ad-notification-track-rate-limit.guard';
import { AdNotificationAdminController } from './ad-notification-admin.controller';
import { AdNotificationController } from './ad-notification.controller';
import { AdNotificationDispatchCron } from './ad-notification-dispatch.cron';
import { AdNotificationDispatchQueueService } from './ad-notification-dispatch-queue.service';
import { AdNotificationService } from './ad-notification.service';
import { AdsAdminController } from './ads-admin.controller';
import { AdsAdminService } from './ads-admin.service';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Module({
  controllers: [
    AdsController,
    AdsAdminController,
    AdNotificationController,
    AdNotificationAdminController,
  ],
  providers: [
    AdsService,
    AdsAdminService,
    AdNotificationService,
    AdNotificationDispatchQueueService,
    AdNotificationDispatchCron,
    AdNotificationTrackRateLimitGuard,
  ],
  imports: [
    AuthModule,
    MailerModule,
    NotificationsModule,
    MediasModule,
    TeamsModule,
    SubscriptionsModule,
    SearchSettingsModule,
    SupportedCountriesModule,
    VendorStatusEmailModule,
    WsNotifyModule,
    SmsModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      { name: AdNotificationEventModel.name, schema: AdNotificationEventSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdEventModel.name, schema: AdEventSchema },
      { name: AdCampaignModel.name, schema: AdCampaignSchema },
      { name: AdCampaignEventModel.name, schema: AdCampaignEventSchema },
      { name: AdPricingSettingsModel.name, schema: AdPricingSettingsSchema },
      {
        name: AdNotificationPricingSettingsModel.name,
        schema: AdNotificationPricingSettingsSchema,
      },
      { name: AdCreditPaymentModel.name, schema: AdCreditPaymentSchema },
      { name: StoreAdCashLedgerModel.name, schema: StoreAdCashLedgerSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: MarketingOfferListingModel.name, schema: MarketingOfferListingSchema },
      { name: MarketingOfferSectionModel.name, schema: MarketingOfferSectionSchema },
      { name: MarketingOfferModel.name, schema: MarketingOfferSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: UserModel.name, schema: UserSchema },
      {
        name: AdsTargetingProfileModel.name,
        schema: AdsTargetingProfileSchema,
      },
    ]),
  ],
  exports: [AdsService],
})
export class AdsModule {}
