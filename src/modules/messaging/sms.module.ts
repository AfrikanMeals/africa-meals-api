import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MaintenanceAlertSettingsModel,
  MaintenanceAlertSettingsSchema,
} from '@schemas/maintenance-alert-settings.schema';
import { SmsDispatchService } from './sms-dispatch.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: MaintenanceAlertSettingsModel.name,
        schema: MaintenanceAlertSettingsSchema,
      },
    ]),
  ],
  providers: [SmsDispatchService],
  exports: [SmsDispatchService],
})
export class SmsModule {}
