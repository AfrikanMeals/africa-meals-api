import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SupportedCountryModel,
  SupportedCountrySchema,
} from '@schemas/supported-country.schema';
import { SupportedCountriesController } from './supported-countries.controller';
import { SupportedCountriesService } from './supported-countries.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportedCountryModel.name, schema: SupportedCountrySchema },
    ]),
  ],
  controllers: [SupportedCountriesController],
  providers: [SupportedCountriesService],
  exports: [SupportedCountriesService],
})
export class SupportedCountriesModule {}
