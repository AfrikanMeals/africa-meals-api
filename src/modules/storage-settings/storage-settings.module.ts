import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  StorageSettingsModel,
  StorageSettingsSchema,
} from '@schemas/storage-settings.schema';
import { StorageSettingsController } from './storage-settings.controller';
import { StorageSettingsService } from './storage-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StorageSettingsModel.name, schema: StorageSettingsSchema },
    ]),
  ],
  controllers: [StorageSettingsController],
  providers: [StorageSettingsService],
  exports: [StorageSettingsService],
})
export class StorageSettingsModule {}
