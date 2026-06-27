import { Module } from '@nestjs/common';
import { RequestStatsModule } from '@modules/request-stats/request-stats.module';
import { PrometheusMetricsController } from './prometheus-metrics.controller';
import { PrometheusMetricsService } from './prometheus-metrics.service';

@Module({
  imports: [RequestStatsModule],
  controllers: [PrometheusMetricsController],
  providers: [PrometheusMetricsService],
})
export class MetricsModule {}
