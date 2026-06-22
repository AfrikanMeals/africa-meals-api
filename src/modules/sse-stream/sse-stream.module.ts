import { AuthModule } from '@modules/auth/auth.module';
import { DbMaintenanceModule } from '@modules/db-maintenance/db-maintenance.module';
import { SearchSettingsModule } from '@modules/search-settings/search-settings.module';
import { FleetModule } from '@modules/fleet/fleet.module';
import { RequestStatsModule } from '@modules/request-stats/request-stats.module';
import { DomainEventHandlersModule } from '@modules/domain-event-handlers/domain-event-handlers.module';
import { MaintenanceAlertsModule } from '@modules/maintenance-alerts/maintenance-alerts.module';
import { DynamicModule, Module, forwardRef } from '@nestjs/common';
import { AppService } from '../../app.service';
import { isSseHttpOnApi } from '../../common/sse/sse-redis.channels';
import { SseJwtAuthGuard } from './guards/sse-jwt-auth.guard';
import { PublicInfraStatusService } from './public-infra-status.service';
import { PublicStatusProbeService } from './public-status-probe.service';
import { SseBackgroundPublisherService } from './sse-background-publisher.service';
import { SseStreamController } from './sse-stream.controller';
import { SseStreamSourcesService } from './sse-stream-sources.service';
import { CheckoutSessionSseModule } from './checkout-session-sse.module';
import { SseStreamService } from './sse-stream.service';

const sseProviders = [
  SseStreamService,
  SseStreamSourcesService,
  PublicStatusProbeService,
  PublicInfraStatusService,
  SseBackgroundPublisherService,
  SseJwtAuthGuard,
  AppService,
];

@Module({
  imports: [
    AuthModule,
    SearchSettingsModule,
    DbMaintenanceModule,
    FleetModule,
    DomainEventHandlersModule,
    CheckoutSessionSseModule,
    forwardRef(() => MaintenanceAlertsModule),
  ],
  providers: sseProviders,
  exports: [
    SseStreamService,
    SseStreamSourcesService,
    CheckoutSessionSseModule,
    PublicInfraStatusService,
  ],
})
export class SseStreamModule {
  static register(): DynamicModule {
    const httpEnabled = isSseHttpOnApi();
    return {
      module: SseStreamModule,
      imports: [
        AuthModule,
        SearchSettingsModule,
        DbMaintenanceModule,
        FleetModule,
        RequestStatsModule,
        DomainEventHandlersModule,
        CheckoutSessionSseModule,
        forwardRef(() => MaintenanceAlertsModule),
      ],
      controllers: httpEnabled ? [SseStreamController] : [],
      providers: sseProviders,
      exports: [
    SseStreamService,
    SseStreamSourcesService,
    CheckoutSessionSseModule,
    PublicInfraStatusService,
  ],
    };
  }
}
