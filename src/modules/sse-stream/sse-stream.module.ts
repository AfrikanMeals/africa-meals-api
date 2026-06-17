import { AuthModule } from '@modules/auth/auth.module';
import { DbMaintenanceModule } from '@modules/db-maintenance/db-maintenance.module';
import { SearchSettingsModule } from '@modules/search-settings/search-settings.module';
import { DomainEventHandlersModule } from '@modules/domain-event-handlers/domain-event-handlers.module';
import { Module } from '@nestjs/common';
import { AppService } from '../../app.service';
import { SseJwtAuthGuard } from './guards/sse-jwt-auth.guard';
import { PublicStatusProbeService } from './public-status-probe.service';
import { SseStreamController } from './sse-stream.controller';
import { SseStreamSourcesService } from './sse-stream-sources.service';
import { SseStreamService } from './sse-stream.service';

@Module({
  imports: [AuthModule, SearchSettingsModule, DbMaintenanceModule, DomainEventHandlersModule],
  controllers: [SseStreamController],
  providers: [
    SseStreamService,
    SseStreamSourcesService,
    PublicStatusProbeService,
    SseJwtAuthGuard,
    AppService,
  ],
})
export class SseStreamModule {}
