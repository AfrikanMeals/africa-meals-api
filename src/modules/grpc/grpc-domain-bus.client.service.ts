import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getProtoServiceClientConstructor,
  grpc,
  grpcInternalMetadata,
  loadDomainBusV1,
  parsePositiveInt,
} from '@africa-meals/proto';
import type { DomainEventEnvelope } from '../../common/domain-events/domain-event.types';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { GrpcVersionService } from './grpc-version.service';

type DomainBusClient = {
  PublishDomainEvent: (
    req: Record<string, string | number>,
    md: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (
      err: grpc.ServiceError | null,
      res?: { accepted?: number; failed?: number; error?: string },
    ) => void,
  ) => void;
};

@Injectable()
export class GrpcDomainBusClientService {
  private readonly logger = new Logger(GrpcDomainBusClientService.name);
  private client: DomainBusClient | null = null;
  private secret = '';
  private deadlineMs = 5000;

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretManagerService,
    private readonly grpcVersion: GrpcVersionService,
  ) {}

  isEnabled(): boolean {
    if (!this.grpcVersion.supportsPhase3() || !this.grpcVersion.hasPhase3Implementation()) {
      return false;
    }
    const raw = (this.config.get<string>('GRPC_DOMAIN_BUS_ENABLED') ?? 'false')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  mqttFallbackEnabled(): boolean {
    const raw = (
      this.config.get<string>('GRPC_DOMAIN_BUS_MQTT_FALLBACK_ENABLED') ?? 'true'
    )
      .trim()
      .toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  private async ensureClient(): Promise<boolean> {
    if (!this.isEnabled()) return false;
    if (this.client && this.secret) return true;
    this.secret =
      (await this.secrets.resolveString('api', 'INTERNAL_NOTIFY_SECRET')) ||
      this.config.get<string>('GRPC_INTERNAL_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim() ||
      '';
    if (!this.secret) return false;

    const host =
      this.config.get<string>('GRPC_WS_HOST')?.trim() || '127.0.0.1';
    const port = parsePositiveInt(this.config.get<string>('GRPC_WS_PORT'), 50051);
    this.deadlineMs = parsePositiveInt(
      this.config.get<string>('GRPC_DEADLINE_MS'),
      5000,
    );

    const pkg = loadDomainBusV1();
    const ctor = getProtoServiceClientConstructor(
      pkg,
      'wiseeat',
      'domain',
      'v1',
      'DomainEventBusService',
    );
    if (!ctor) return false;

    this.client = new ctor(
      `${host}:${port}`,
      grpc.credentials.createInsecure(),
    ) as unknown as DomainBusClient;
    return true;
  }

  envelopeToMessage(envelope: DomainEventEnvelope): Record<string, string | number> {
    return {
      id: envelope.id,
      type: envelope.type,
      version: envelope.version,
      occurredAt: envelope.occurredAt,
      payloadJson: JSON.stringify(envelope.payload ?? {}),
      metadataJson: JSON.stringify(envelope.metadata ?? {}),
    };
  }

  async publishDomainEvent(envelope: DomainEventEnvelope): Promise<boolean> {
    if (!(await this.ensureClient()) || !this.client) return false;
    const md = grpcInternalMetadata(this.secret);
    const deadline = new Date(Date.now() + this.deadlineMs);
    const req = this.envelopeToMessage(envelope);
    return new Promise((resolve) => {
      this.client!.PublishDomainEvent(req, md, { deadline }, (err, res) => {
        if (err) {
          this.logger.warn(
            `DomainEventBus gRPC failed id=${envelope.id}: ${err.message}`,
          );
          resolve(false);
          return;
        }
        if ((res?.failed ?? 0) > 0 || res?.accepted !== 1) {
          this.logger.warn(
            `DomainEventBus gRPC rejected id=${envelope.id}: ${res?.error ?? 'unknown'}`,
          );
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }
}
