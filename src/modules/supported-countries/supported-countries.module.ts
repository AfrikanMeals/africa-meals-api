import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StoreAccessModule } from '@modules/teams/store-access.module';
import {
  AdNotificationPricingSettingsModel,
  AdNotificationPricingSettingsSchema,
} from '@schemas/ad-notification-pricing-settings.schema';
import {
  AdPricingSettingsModel,
  AdPricingSettingsSchema,
} from '@schemas/ad-pricing-settings.schema';
import {
  SupportedCountryModel,
  SupportedCountrySchema,
} from '@schemas/supported-country.schema';
import {
  PlatformRegionSettingsModel,
  PlatformRegionSettingsSchema,
} from '@schemas/platform-region-settings.schema';
import {
  VendorNotificationPricingSettingsModel,
  VendorNotificationPricingSettingsSchema,
} from '@schemas/vendor-notification-pricing-settings.schema';
import { SupportedCountriesController } from './supported-countries.controller';
import { SupportedCountriesService } from './supported-countries.service';
import { RegionPricingService } from './region-pricing.service';

@Global()
@Module({
  imports: [
    StoreAccessModule,
    MongooseModule.forFeature([
      { name: SupportedCountryModel.name, schema: SupportedCountrySchema },
      {
        name: PlatformRegionSettingsModel.name,
        schema: PlatformRegionSettingsSchema,
      },
      { name: AdPricingSettingsModel.name, schema: AdPricingSettingsSchema },
      {
        name: AdNotificationPricingSettingsModel.name,
        schema: AdNotificationPricingSettingsSchema,
      },
      {
        name: VendorNotificationPricingSettingsModel.name,
        schema: VendorNotificationPricingSettingsSchema,
      },
    ]),
  ],
  controllers: [SupportedCountriesController],
  providers: [SupportedCountriesService, RegionPricingService],
  exports: [SupportedCountriesService, RegionPricingService],
})
export class SupportedCountriesModule {}
