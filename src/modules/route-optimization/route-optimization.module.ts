import { Module } from '@nestjs/common';
import { MapSettingsModule } from '@modules/map-settings/map-settings.module';
import { MapEngineCacheModule } from '@modules/map-engine-cache/map-engine-cache.module';
import { RoutingMatrixService } from './routing-matrix.service';
import { VroomClient } from './vroom.client';
import { VroomDispatchService } from './vroom-dispatch.service';

/**
 * Optimisation tournées (VROOM) — matrices multi-moteurs.
 * Cache matrices Redis L1 via MapEngineCacheModule.
 */
@Module({
  imports: [MapSettingsModule, MapEngineCacheModule],
  providers: [VroomClient, RoutingMatrixService, VroomDispatchService],
  exports: [VroomClient, RoutingMatrixService, VroomDispatchService],
})
export class RouteOptimizationModule {}
