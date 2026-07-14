import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Neo4jModule } from '@modules/neo4j/neo4j.module';
import { BullmqRedisModule } from '../../common/redis/bullmq-redis-connections.service';
import { GraphMapIntelligenceService } from './graph-map-intelligence.service';
import { GraphRecommendationService } from './graph-recommendation.service';
import { GraphSimilarityCron } from './graph-similarity.cron';
import { GraphSyncQueueService } from './graph-sync-queue.service';
import { GraphSyncService } from './graph-sync.service';
import { RecommendationFacade } from './recommendation-facade.service';

@Module({
  imports: [ConfigModule, Neo4jModule, BullmqRedisModule],
  providers: [
    GraphSyncService,
    GraphSyncQueueService,
    GraphRecommendationService,
    GraphMapIntelligenceService,
    RecommendationFacade,
    GraphSimilarityCron,
  ],
  exports: [
    GraphSyncService,
    GraphSyncQueueService,
    GraphRecommendationService,
    GraphMapIntelligenceService,
    RecommendationFacade,
  ],
})
export class GraphModule {}
