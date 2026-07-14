import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MapHistoricalRouteModel,
  MapHistoricalRouteSchema,
} from '@schemas/map-historical-route.schema';
import {
  MapProviderStatModel,
  MapProviderStatSchema,
} from '@schemas/map-provider-stat.schema';
import {
  MapTrafficSampleModel,
  MapTrafficSampleSchema,
} from '@schemas/map-traffic-sample.schema';
import {
  MapCourierGpsHistoryModel,
  MapCourierGpsHistorySchema,
} from '@schemas/map-courier-gps-history.schema';
import { MapEngineCacheService } from './map-engine-cache.service';
import { MapEngineHistoryService } from './map-engine-history.service';

/**
 * Multi-Level Cache map engine :
 * L1 Redis (route / ETA / matrix / traffic) · L2 Mongo (historique / stats)
 * Neo4j = graphe intelligence (zones / courier / reco) — pas road graph OSRM.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: MapProviderStatModel.name, schema: MapProviderStatSchema },
      { name: MapTrafficSampleModel.name, schema: MapTrafficSampleSchema },
      { name: MapHistoricalRouteModel.name, schema: MapHistoricalRouteSchema },
      {
        name: MapCourierGpsHistoryModel.name,
        schema: MapCourierGpsHistorySchema,
      },
    ]),
  ],
  providers: [MapEngineHistoryService, MapEngineCacheService],
  exports: [MapEngineHistoryService, MapEngineCacheService],
})
export class MapEngineCacheModule {}
