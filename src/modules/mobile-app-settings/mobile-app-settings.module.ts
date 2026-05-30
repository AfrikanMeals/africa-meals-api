import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MobileAppSettingsModel,
  MobileAppSettingsSchema,
} from '@schemas/mobile-app-settings.schema';
import { MobileAppSettingsController } from './mobile-app-settings.controller';
import { MobileAppSettingsService } from './mobile-app-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MobileAppSettingsModel.name, schema: MobileAppSettingsSchema },
    ]),
  ],
  controllers: [MobileAppSettingsController],
  providers: [MobileAppSettingsService],
  exports: [MobileAppSettingsService],
})
export class MobileAppSettingsModule {}
