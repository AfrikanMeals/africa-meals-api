import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PrometheusMetricsService } from './prometheus-metrics.service';

@ApiExcludeController()
@Controller('metrics')
export class PrometheusMetricsController {
  constructor(private readonly metrics: PrometheusMetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  prometheus(): string {
    return this.metrics.render();
  }
}
