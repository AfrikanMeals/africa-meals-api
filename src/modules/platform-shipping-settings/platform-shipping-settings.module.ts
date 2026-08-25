import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import {
  PlatformShippingSettingsModel,
  PlatformShippingSettingsSchema,
} from '@schemas/platform-shipping-settings.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PlatformShippingQuoteService } from './platform-shipping-quote.service';
import { PlatformShippingSettingsController } from './platform-shipping-settings.controller';
import { PlatformShippingSettingsService } from './platform-shipping-settings.service';
import { RouteOptimizationModule } from '@modules/route-optimization/route-optimization.module';

@Module({
  imports: [
    SupportedCountriesModule,
    RouteOptimizationModule,
    MongooseModule.forFeature([
      {
        name: PlatformShippingSettingsModel.name,
        schema: PlatformShippingSettingsSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: AddressModel.name, schema: AddressSchema },
    ]),
  ],
  controllers: [PlatformShippingSettingsController],
  providers: [PlatformShippingSettingsService, PlatformShippingQuoteService],
  exports: [PlatformShippingSettingsService, PlatformShippingQuoteService],
})
export class PlatformShippingSettingsModule {}
