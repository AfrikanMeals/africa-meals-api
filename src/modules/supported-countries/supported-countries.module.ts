import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SupportedCountryModel,
  SupportedCountrySchema,
} from '@schemas/supported-country.schema';
import { TeamsModule } from '@modules/teams/teams.module';
import { SupportedCountriesController } from './supported-countries.controller';
import { SupportedCountriesService } from './supported-countries.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      { name: SupportedCountryModel.name, schema: SupportedCountrySchema },
    ]),
  ],
  controllers: [SupportedCountriesController],
  providers: [SupportedCountriesService],
  exports: [SupportedCountriesService],
})
export class SupportedCountriesModule {}
