import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  GeocodeCacheEntryModel,
  GeocodeCacheEntrySchema,
} from '@schemas/geocode-cache-entry.schema';
import { MapSettingsModule } from '../map-settings/map-settings.module';
import { SecretManagerModule } from '../secret-manager/secret-manager.module';
import { GeocodeCacheService } from './geocode-cache.service';
import { GeocodeController } from './geocode.controller';
import { GeocodeService } from './geocode.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GeocodeCacheEntryModel.name, schema: GeocodeCacheEntrySchema },
    ]),
    MapSettingsModule,
    SecretManagerModule,
  ],
  controllers: [GeocodeController],
  providers: [GeocodeCacheService, GeocodeService],
  exports: [GeocodeCacheService, GeocodeService],
})
export class GeocodeModule {}
