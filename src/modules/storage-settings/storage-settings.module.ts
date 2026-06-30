import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DomainEventHandlersModule } from '@modules/domain-event-handlers/domain-event-handlers.module';
import { MediasModule } from '@modules/medias/medias.module';
import { TeamsModule } from '@modules/teams/teams.module';
import {
  StorageSettingsModel,
  StorageSettingsSchema,
} from '@schemas/storage-settings.schema';
import {
  StorageTransferRunModel,
  StorageTransferRunSchema,
} from '@schemas/storage-transfer-run.schema';
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
    forwardRef(() => DomainEventHandlersModule),
    TeamsModule,
  ],
  controllers: [StorageSettingsController],
  providers: [StorageSettingsService, StorageTransferService],
  exports: [StorageSettingsService],
})
export class StorageSettingsModule {}
