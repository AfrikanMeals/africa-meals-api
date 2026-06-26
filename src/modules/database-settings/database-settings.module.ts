import { Module, forwardRef } from '@nestjs/common';
import { DomainEventHandlersModule } from '@modules/domain-event-handlers/domain-event-handlers.module';
import { CronMonitorModule } from '@modules/cron-monitor/cron-monitor.module';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DatabaseBackupRunModel,
  DatabaseBackupRunSchema,
} from '@schemas/database-backup-run.schema';
import {
  DatabaseSettingsModel,
  DatabaseSettingsSchema,
} from '@schemas/database-settings.schema';
import { TeamsModule } from '../teams/teams.module';
import { DatabaseBackupCron } from './database-backup.cron';
import { DatabaseOperationsService } from './database-operations.service';
import { DatabaseSettingsController } from './database-settings.controller';
import { DatabaseSettingsService } from './database-settings.service';

@Module({
  imports: [
    TeamsModule,
    CronMonitorModule,
    forwardRef(() => DomainEventHandlersModule),
    MongooseModule.forFeature([
      { name: DatabaseSettingsModel.name, schema: DatabaseSettingsSchema },
      { name: DatabaseBackupRunModel.name, schema: DatabaseBackupRunSchema },
    ]),
  ],
  controllers: [DatabaseSettingsController],
  providers: [
    DatabaseSettingsService,
    DatabaseOperationsService,
    DatabaseBackupCron,
  ],
  exports: [DatabaseSettingsService],
})
export class DatabaseSettingsModule {}
