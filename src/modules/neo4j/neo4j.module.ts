import { Global, Module } from '@nestjs/common';
import { GraphMetricsService } from './graph-metrics.service';
import { Neo4jService } from './neo4j.service';

@Global()
@Module({
  providers: [GraphMetricsService, Neo4jService],
  exports: [GraphMetricsService, Neo4jService],
})
export class Neo4jModule {}
