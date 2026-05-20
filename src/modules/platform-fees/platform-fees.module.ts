import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformFeesSettingsModel,
  PlatformFeesSettingsSchema,
} from '@schemas/platform-fees-settings.schema';
import { PlatformFeesController } from './platform-fees.controller';
import { PlatformFeesService } from './platform-fees.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PlatformFeesSettingsModel.name,
        schema: PlatformFeesSettingsSchema,
      },
    ]),
  ],
  controllers: [PlatformFeesController],
  providers: [PlatformFeesService],
  exports: [PlatformFeesService],
})
export class PlatformFeesModule {}
