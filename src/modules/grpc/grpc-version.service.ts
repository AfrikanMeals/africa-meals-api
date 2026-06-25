import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  grpcVersionSupportsCoreInternal,
  grpcVersionSupportsPhase3,
  grpcVersionSupportsPhase4,
  parseGrpcVersion,
} from '@africa-meals/proto';

@Injectable()
export class GrpcVersionService implements OnModuleInit {
  private readonly logger = new Logger(GrpcVersionService.name);
  readonly version: number;

  constructor(private readonly config: ConfigService) {
    this.version = parseGrpcVersion(this.config.get<string>('GRPC_VERSION'));
  }

  onModuleInit(): void {
    this.logger.log(
      `GRPC_VERSION=${this.version} — Phases 0–2 ${this.supportsCoreInternal() ? 'autorisées' : 'bloquées'}`,
    );
    if (this.supportsPhase3() && !this.hasPhase3Implementation()) {
      this.logger.warn(
        `GRPC_VERSION=${this.version} (Phase 3) — tickets GRPC-301+ non livrés ; chemins v1–v2 inchangés`,
      );
    }
    if (this.supportsPhase4() && !this.hasPhase4Implementation()) {
      this.logger.warn(
        `GRPC_VERSION=${this.version} (Phase 4) — tickets GRPC-N01+ non livrés ; hors périmètre actuel`,
      );
    }
  }

  supportsCoreInternal(): boolean {
    return grpcVersionSupportsCoreInternal(this.version);
  }

  supportsPhase3(): boolean {
    return grpcVersionSupportsPhase3(this.version);
  }

  supportsPhase4(): boolean {
    return grpcVersionSupportsPhase4(this.version);
  }

  /** GRPC-301–304 livrés derrière flags Phase 3. */
  hasPhase3Implementation(): boolean {
    return true;
  }

  /** GRPC-N01–N05 — ponts internes derrière GRPC_VERSION=3 + flags. */
  hasPhase4Implementation(): boolean {
    return true;
  }
}
