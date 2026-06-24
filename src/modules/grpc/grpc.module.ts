import { Module } from '@nestjs/common';
import { GrpcWsNotifyClientService } from './grpc-ws-notify.client.service';
import { GrpcWsNotifyMetricsService } from './grpc-ws-notify.metrics.service';

@Module({
  providers: [GrpcWsNotifyMetricsService, GrpcWsNotifyClientService],
  exports: [GrpcWsNotifyMetricsService, GrpcWsNotifyClientService],
})
export class GrpcModule {}
