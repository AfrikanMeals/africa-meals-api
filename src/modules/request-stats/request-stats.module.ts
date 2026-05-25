import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TeamsModule } from '../teams/teams.module';
import { RequestStatsAdminController } from './request-stats-admin.controller';
import { RequestStatsInterceptor } from './request-stats.interceptor';
import { RequestStatsService } from './request-stats.service';
import { RequestStatsStore } from './request-stats.store';

@Module({
  imports: [TeamsModule],
  controllers: [RequestStatsAdminController],
  providers: [
    RequestStatsStore,
    RequestStatsService,
    RequestStatsInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestStatsInterceptor,
    },
  ],
  exports: [RequestStatsStore, RequestStatsService],
})
export class RequestStatsModule {}
