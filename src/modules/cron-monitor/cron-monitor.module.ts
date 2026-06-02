import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InfraCronJobStateModel,
  InfraCronJobStateSchema,
} from '@schemas/infra-cron-job-state.schema';
import { TeamsModule } from '@modules/teams/teams.module';
import { CronMonitorAdminController } from './cron-monitor-admin.controller';
import { CronMonitorService } from './cron-monitor.service';

@Global()
@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      { name: InfraCronJobStateModel.name, schema: InfraCronJobStateSchema },
    ]),
  ],
  controllers: [CronMonitorAdminController],
  providers: [CronMonitorService],
  exports: [CronMonitorService],
})
export class CronMonitorModule {}
