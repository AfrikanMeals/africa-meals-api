import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PlatformChannelSettingsModel,
  PlatformChannelSettingsSchema,
} from '@schemas/platform-channel-settings.schema';
import {
  MaintenanceAlertSettingsModel,
  MaintenanceAlertSettingsSchema,
} from '@schemas/maintenance-alert-settings.schema';
import { PlatformChannelsController } from './platform-channels.controller';
import { PlatformChannelsService } from './platform-channels.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: PlatformChannelSettingsModel.name,
        schema: PlatformChannelSettingsSchema,
      },
      {
        name: MaintenanceAlertSettingsModel.name,
        schema: MaintenanceAlertSettingsSchema,
      },
    ]),
  ],
  controllers: [PlatformChannelsController],
  providers: [PlatformChannelsService],
  exports: [PlatformChannelsService],
})
export class PlatformChannelsModule {}
