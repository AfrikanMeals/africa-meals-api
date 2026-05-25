import { Module } from '@nestjs/common';
import { TeamsModule } from '../teams/teams.module';
import { DbMaintenanceAdminController } from './db-maintenance-admin.controller';
import { DbMaintenanceService } from './db-maintenance.service';

@Module({
  imports: [TeamsModule],
  controllers: [DbMaintenanceAdminController],
  providers: [DbMaintenanceService],
})
export class DbMaintenanceModule {}
