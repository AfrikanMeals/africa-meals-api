import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
  VendorNotificationPricingSettingsModel,
  VendorNotificationPricingSettingsSchema,
} from '@schemas/vendor-notification-pricing-settings.schema';
import { TeamsModule } from '@modules/teams/teams.module';
import { SupportedCountriesController } from './supported-countries.controller';
import { SupportedCountriesService } from './supported-countries.service';
import { RegionPricingService } from './region-pricing.service';

@Module({
  imports: [
    forwardRef(() => TeamsModule),
    MongooseModule.forFeature([
      { name: SupportedCountryModel.name, schema: SupportedCountrySchema },
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
