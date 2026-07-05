import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  GeocodeCacheEntryModel,
  GeocodeCacheEntrySchema,
} from '@schemas/geocode-cache-entry.schema';
import {
  MapSettingsModel,
  MapSettingsSchema,
} from '@schemas/map-settings.schema';
import { MapGeocodeUsageService } from './map-geocode-usage.service';
import { MapSettingsController } from './map-settings.controller';
import { MapSettingsService } from './map-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MapSettingsModel.name, schema: MapSettingsSchema },
      { name: GeocodeCacheEntryModel.name, schema: GeocodeCacheEntrySchema },
    ]),
  ],
  controllers: [MapSettingsController],
  providers: [MapSettingsService, MapGeocodeUsageService],
  exports: [MapSettingsService, MapGeocodeUsageService],
})
export class MapSettingsModule {}
