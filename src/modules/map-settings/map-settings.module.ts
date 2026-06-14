import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MapSettingsModel,
  MapSettingsSchema,
} from '@schemas/map-settings.schema';
import { MapSettingsController } from './map-settings.controller';
import { MapSettingsService } from './map-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MapSettingsModel.name, schema: MapSettingsSchema },
    ]),
  ],
  controllers: [MapSettingsController],
  providers: [MapSettingsService],
  exports: [MapSettingsService],
})
export class MapSettingsModule {}
