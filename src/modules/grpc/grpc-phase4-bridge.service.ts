import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrpcVersionService } from './grpc-version.service';

/**
 * GRPC-N01–N05 — ponts Phase 4 (internes, désactivés par défaut).
 * Les clients mobile/admin/web restent sur REST/GraphQL/Socket.IO/SSE.
 */
@Injectable()
export class GrpcPhase4BridgeService {
  constructor(
    private readonly config: ConfigService,
    private readonly grpcVersion: GrpcVersionService,
  ) {}

  isPhase4Active(): boolean {
    if (!this.grpcVersion.supportsPhase4() || !this.grpcVersion.hasPhase4Implementation()) {
      return false;
    }
    const raw = (this.config.get<string>('GRPC_PHASE4_BRIDGE_ENABLED') ?? 'false')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  /** GRPC-N01 — preview panier mobile via gRPC interne (voir CartPreviewService :50052). */
  mobileCartPreviewViaGrpc(): boolean {
    return (
      this.isPhase4Active() &&
      this.readFlag('GRPC_PHASE4_MOBILE_CART_ENABLED', false)
    );
  }

  /** GRPC-N02 — GraphQL → gRPC (non recommandé). */
  graphqlBridgeEnabled(): boolean {
    return this.isPhase4Active() && this.readFlag('GRPC_PHASE4_GRAPHQL_ENABLED', false);
  }

  /** GRPC-N03 — Socket.IO → gRPC (non recommandé). */
  socketIoBridgeEnabled(): boolean {
    return this.isPhase4Active() && this.readFlag('GRPC_PHASE4_SOCKETIO_ENABLED', false);
  }

  /** GRPC-N04 — SSE admin → gRPC (non recommandé). */
  sseBridgeEnabled(): boolean {
    return this.isPhase4Active() && this.readFlag('GRPC_PHASE4_SSE_ENABLED', false);
  }

  /** GRPC-N05 — gRPC public Internet (désactivé — risque sécurité). */
  publicInternetGrpcEnabled(): boolean {
    return (
      this.isPhase4Active() &&
      this.readFlag('GRPC_PUBLIC_INTERNET_ENABLED', false)
    );
  }

  getCapabilities() {
    return {
      phase4Active: this.isPhase4Active(),
      mobileCartPreviewViaGrpc: this.mobileCartPreviewViaGrpc(),
      graphqlBridgeEnabled: this.graphqlBridgeEnabled(),
      socketIoBridgeEnabled: this.socketIoBridgeEnabled(),
      sseBridgeEnabled: this.sseBridgeEnabled(),
      publicInternetGrpcEnabled: this.publicInternetGrpcEnabled(),
    };
  }

  private readFlag(key: string, defaultValue: boolean): boolean {
    const raw = (this.config.get<string>(key) ?? String(defaultValue))
      .trim()
      .toLowerCase();
    if (defaultValue) {
      return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
    }
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }
}
