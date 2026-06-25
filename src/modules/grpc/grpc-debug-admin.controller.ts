import {
  Controller,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '@modules/auth/guards/jwt.guard';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import { DbMaintenanceService } from '@modules/db-maintenance/db-maintenance.service';
import { GrpcDomainBusClientService } from './grpc-domain-bus.client.service';
import { GrpcVersionService } from './grpc-version.service';
import { GrpcPhase4BridgeService } from './grpc-phase4-bridge.service';
import { GrpcWsNotifyClientService } from './grpc-ws-notify.client.service';
import { probeGrpcApiInternal, probeGrpcWsNotify } from '@modules/db-maintenance/system-exchange.probes';
import { ConfigService } from '@nestjs/config';

/** GRPC-303 — debug gRPC admin (REST, pas grpc-gateway public). */
@Controller('db-maintenance/admin/grpc-debug')
@UseGuards(JwtGuard)
export class GrpcDebugAdminController {
  constructor(
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly config: ConfigService,
    private readonly grpcVersion: GrpcVersionService,
    private readonly grpcWsNotify: GrpcWsNotifyClientService,
    private readonly grpcDomainBus: GrpcDomainBusClientService,
    private readonly grpcPhase4: GrpcPhase4BridgeService,
  ) {}

  @Get()
  async status(@Req() req: Request) {
    await this.dbMaintenance.assertAdminSettingsPermission(req.user as UserModel);
    const [wsProbe, apiProbe] = await Promise.all([
      probeGrpcWsNotify(this.config),
      probeGrpcApiInternal(this.config),
    ]);
    return {
      grpcVersion: this.grpcVersion.version,
      phase3: {
        implemented: this.grpcVersion.hasPhase3Implementation(),
        domainBusEnabled: this.grpcDomainBus.isEnabled(),
        domainBusMqttFallback: this.grpcDomainBus.mqttFallbackEnabled(),
      },
      phase4: {
        implemented: this.grpcVersion.hasPhase4Implementation(),
        capabilities: this.grpcPhase4.getCapabilities(),
      },
      wsNotify: {
        envEnabled: this.grpcWsNotify.isEnvEnabled(),
        httpFallback: this.grpcWsNotify.httpFallbackEnabled(),
      },
      probes: {
        wsNotify: wsProbe,
        apiInternal: apiProbe,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
