import { Module } from '@nestjs/common';
import { MapSettingsModule } from '@modules/map-settings/map-settings.module';
import { RoutingMatrixService } from './routing-matrix.service';
import { VroomClient } from './vroom.client';
import { VroomDispatchService } from './vroom-dispatch.service';

/**
 * Optimisation tournées (VROOM) — matrices multi-moteurs :
 * OSRM, Valhalla, Mapbox, Google, HERE, TomTom.
 */
@Module({
  imports: [MapSettingsModule],
  providers: [VroomClient, RoutingMatrixService, VroomDispatchService],
  exports: [VroomClient, RoutingMatrixService, VroomDispatchService],
})
export class RouteOptimizationModule {}
