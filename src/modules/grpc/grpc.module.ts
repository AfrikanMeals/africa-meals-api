import { Module } from '@nestjs/common';
import { GrpcWsNotifyClientService } from './grpc-ws-notify.client.service';
import { GrpcWsNotifyMetricsService } from './grpc-ws-notify.metrics.service';
import { GrpcVersionService } from './grpc-version.service';
import { GrpcDomainBusClientService } from './grpc-domain-bus.client.service';
import { GrpcPhase4BridgeService } from './grpc-phase4-bridge.service';

@Module({
  providers: [
    GrpcVersionService,
    GrpcWsNotifyMetricsService,
    GrpcWsNotifyClientService,
    GrpcDomainBusClientService,
    GrpcPhase4BridgeService,
  ],
  exports: [
    GrpcVersionService,
    GrpcWsNotifyMetricsService,
    GrpcWsNotifyClientService,
    GrpcDomainBusClientService,
    GrpcPhase4BridgeService,
  ],
})
export class GrpcModule {}
