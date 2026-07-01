import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformThemeSettingsModel,
  PlatformThemeSettingsSchema,
} from '@schemas/platform-theme-settings.schema';
import { MediasModule } from '@modules/medias/medias.module';
import { PlatformThemeSettingsController } from './platform-theme-settings.controller';
import { PlatformThemeSettingsService } from './platform-theme-settings.service';

@Module({
  imports: [
    MediasModule,
    MongooseModule.forFeature([
      {
        name: PlatformThemeSettingsModel.name,
        schema: PlatformThemeSettingsSchema,
      },
    ]),
  ],
  controllers: [PlatformThemeSettingsController],
  providers: [PlatformThemeSettingsService],
  exports: [PlatformThemeSettingsService],
})
export class PlatformThemeSettingsModule {}
