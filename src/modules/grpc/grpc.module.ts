import { Module } from '@nestjs/common';
import { GrpcWsNotifyClientService } from './grpc-ws-notify.client.service';
import { GrpcWsNotifyMetricsService } from './grpc-ws-notify.metrics.service';
import { GrpcVersionService } from './grpc-version.service';

@Module({
  providers: [
    GrpcVersionService,
    GrpcWsNotifyMetricsService,
    GrpcWsNotifyClientService,
  ],
  exports: [
    GrpcVersionService,
    GrpcWsNotifyMetricsService,
    GrpcWsNotifyClientService,
  ],
})
export class GrpcModule {}
