import { Module } from '@nestjs/common';
import { GrpcModule } from '@modules/grpc/grpc.module';
import { RequestStatsModule } from '@modules/request-stats/request-stats.module';
import { PrometheusMetricsController } from './prometheus-metrics.controller';
import { PrometheusMetricsService } from './prometheus-metrics.service';

@Module({
  imports: [RequestStatsModule, GrpcModule],
  controllers: [PrometheusMetricsController],
  providers: [PrometheusMetricsService],
})
export class MetricsModule {}
