import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediasModule } from '@modules/medias/medias.module';
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
    forwardRef(() => MediasModule),
  ],
  controllers: [StorageSettingsController],
  providers: [StorageSettingsService],
  exports: [StorageSettingsService],
})
export class StorageSettingsModule {}
