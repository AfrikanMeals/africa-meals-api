import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminJobsModule } from '@modules/admin-jobs/admin-jobs.module';
import { MediasModule } from '@modules/medias/medias.module';
import { StoreAccessModule } from '@modules/teams/store-access.module';
import {
  StorageSettingsModel,
  StorageSettingsSchema,
} from '@schemas/storage-settings.schema';
import {
  StorageTransferRunModel,
  StorageTransferRunSchema,
} from '@schemas/storage-transfer-run.schema';
import { MediaUrlNormalizeService } from './media-url-normalize.service';
import { StorageSettingsController } from './storage-settings.controller';
import { StorageSettingsService } from './storage-settings.service';
import { StorageTransferService } from './storage-transfer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StorageSettingsModel.name, schema: StorageSettingsSchema },
      { name: StorageTransferRunModel.name, schema: StorageTransferRunSchema },
    ]),
    forwardRef(() => MediasModule),
    AdminJobsModule,
    StoreAccessModule,
  ],
  controllers: [StorageSettingsController],
  providers: [
    StorageSettingsService,
    StorageTransferService,
    MediaUrlNormalizeService,
  ],
  exports: [StorageSettingsService, MediaUrlNormalizeService],
})
export class StorageSettingsModule {}
