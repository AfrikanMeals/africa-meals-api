import { AuthModule } from '@modules/auth/auth.module';
import { MediasModule } from '@modules/medias/medias.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

@Module({
  controllers: [AdsController],
  providers: [AdsService],
  imports: [
    AuthModule,
    MediasModule,
    TeamsModule,
    SubscriptionsModule,
    MongooseModule.forFeature([
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
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  exports: [AdsService],
})
export class AdsModule {}
