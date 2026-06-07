import { TeamsModule } from '@modules/teams/teams.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DashboardAuditLogModel,
  DashboardAuditLogSchema,
} from '@schemas/dashboard-audit-log.schema';
import { DashboardAuditController } from './dashboard-audit.controller';
import { DashboardAuditService } from './dashboard-audit.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      {
        name: DashboardAuditLogModel.name,
        schema: DashboardAuditLogSchema,
      },
    ]),
  ],
  controllers: [DashboardAuditController],
  providers: [DashboardAuditService],
  exports: [DashboardAuditService],
})
export class DashboardAuditModule {}
