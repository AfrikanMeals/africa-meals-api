import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getProtoServiceClientConstructor,
  grpc,
  grpcInternalMetadata,
  loadNotifyV1,
  parsePositiveInt,
} from '@africa-meals/proto';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { GrpcWsNotifyMetricsService } from './grpc-ws-notify.metrics.service';
import { GrpcVersionService } from './grpc-version.service';

type NotifyClient = {
  Ping: (
    req: Record<string, never>,
    md: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res?: { service?: string }) => void,
  ) => void;
  InboxRefresh: (
    req: { userId: string },
    md: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res?: { ok?: boolean }) => void,
  ) => void;
  OrderDispatch: (
    req: { pathSuffix: string; userId?: string; payloadJson: string },
    md: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res?: { ok?: boolean }) => void,
  ) => void;
  GenericDispatch: (
    req: { pathSuffix: string; payloadJson: string },
    md: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (err: grpc.ServiceError | null, res?: { ok?: boolean }) => void,
  ) => void;
  BatchDispatch: (
    req: {
      items: Array<{ pathSuffix: string; userId?: string; payloadJson: string }>;
    },
    md: grpc.Metadata,
    opts: grpc.CallOptions,
    cb: (
      err: grpc.ServiceError | null,
      res?: { accepted?: number; failed?: number },
    ) => void,
  ) => void;
};

@Injectable()
export class GrpcWsNotifyClientService implements OnModuleDestroy {
  private readonly logger = new Logger(GrpcWsNotifyClientService.name);
  private client: NotifyClient | null = null;
  private secret = '';
  private deadlineMs = 5000;
  private consecutiveFailures = 0;
  private circuitOpenUntilMs = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretManagerService,
    private readonly metrics: GrpcWsNotifyMetricsService,
    private readonly grpcVersion: GrpcVersionService,
  ) {}

  onModuleDestroy(): void {
    this.client = null;
  }

  isEnvEnabled(): boolean {
    if (!this.grpcVersion.supportsCoreInternal()) return false;
    const raw = (this.config.get<string>('GRPC_WS_NOTIFY_ENABLED') ?? 'false')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  httpFallbackEnabled(): boolean {
    const raw = (
      this.config.get<string>('GRPC_HTTP_FALLBACK_ENABLED') ?? 'true'
    )
      .trim()
      .toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  shouldUseGrpc(runtimeFlagEnabled: boolean): boolean {
    if (!this.grpcVersion.supportsCoreInternal()) return false;
    if (!this.isEnvEnabled() && !runtimeFlagEnabled) return false;
    if (Date.now() < this.circuitOpenUntilMs) return false;
    return true;
  }

  private async ensureClient(): Promise<boolean> {
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
    const target = `${host}:${port}`;

    const pkg = loadNotifyV1();
    const notifyCtor = getProtoServiceClientConstructor(
      pkg,
      'wiseeat',
      'notify',
      'v1',
      'NotifyService',
    );
    if (!notifyCtor) return false;

    this.client = new notifyCtor(
      target,
      grpc.credentials.createInsecure(),
    ) as unknown as NotifyClient;
    return true;
  }

  private markSuccess(started: number): void {
    this.consecutiveFailures = 0;
    this.metrics.record(Date.now() - started, true, false);
  }

  private markFailure(started: number, fallback: boolean): void {
    this.metrics.record(Date.now() - started, false, fallback);
    this.consecutiveFailures += 1;
    const threshold = parsePositiveInt(
      this.config.get<string>('GRPC_CIRCUIT_FAILURE_THRESHOLD'),
      5,
    );
    const cooldownMs = parsePositiveInt(
      this.config.get<string>('GRPC_CIRCUIT_COOLDOWN_MS'),
      30_000,
    );
    if (this.consecutiveFailures >= threshold) {
      this.circuitOpenUntilMs = Date.now() + cooldownMs;
      this.logger.warn(
        `gRPC circuit open for ${cooldownMs}ms after ${this.consecutiveFailures} failures`,
      );
    }
  }

  async ping(): Promise<boolean> {
    if (!(await this.ensureClient()) || !this.client) return false;
    const started = Date.now();
    const md = grpcInternalMetadata(this.secret);
    const deadline = new Date(Date.now() + this.deadlineMs);
    return new Promise((resolve) => {
      this.client!.Ping({}, md, { deadline }, (err, res) => {
        if (err || !res?.service) {
          this.markFailure(started, false);
          resolve(false);
          return;
        }
        this.markSuccess(started);
        resolve(true);
      });
    });
  }

  async dispatch(
    pathSuffix: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!(await this.ensureClient()) || !this.client) return false;
    const suffix = pathSuffix.trim();
    if (!suffix) return false;
    const started = Date.now();
    const md = grpcInternalMetadata(this.secret);
    const deadline = new Date(Date.now() + this.deadlineMs);
    const payloadJson = JSON.stringify(payload);
    const userId = String(payload.userId ?? '').trim();

    const runRpc = (
      fn: (
        cb: (err: grpc.ServiceError | null, res?: { ok?: boolean }) => void,
      ) => void,
    ) =>
      new Promise<boolean>((resolve) => {
        fn((err, res) => {
          if (err || res?.ok !== true) {
            this.markFailure(started, false);
            resolve(false);
            return;
          }
          this.markSuccess(started);
          resolve(true);
        });
      });

    if (suffix === 'inbox/refresh') {
      if (!userId) return false;
      return runRpc((cb) =>
        this.client!.InboxRefresh({ userId }, md, { deadline }, cb),
      );
    }

    const orderPaths = new Set([
      'order/update',
      'order/tracking',
      'order/changed',
      'order/staff-broadcast',
    ]);
    if (orderPaths.has(suffix)) {
      return runRpc((cb) =>
        this.client!.OrderDispatch(
          { pathSuffix: suffix, userId, payloadJson },
          md,
          { deadline },
          cb,
        ),
      );
    }

    return runRpc((cb) =>
      this.client!.GenericDispatch({ pathSuffix: suffix, payloadJson }, md, { deadline }, cb),
    );
  }

  async batchDispatch(
    items: Array<{ pathSuffix: string; payload: Record<string, unknown> }>,
  ): Promise<boolean> {
    if (!(await this.ensureClient()) || !this.client) return false;
    if (!items.length) return true;
    const started = Date.now();
    const md = grpcInternalMetadata(this.secret);
    const deadline = new Date(Date.now() + this.deadlineMs);
    const rpcItems = items.slice(0, 500).map((item) => ({
      pathSuffix: item.pathSuffix,
      userId: String(item.payload.userId ?? '').trim() || undefined,
      payloadJson: JSON.stringify(item.payload),
    }));

    return new Promise((resolve) => {
      this.client!.BatchDispatch({ items: rpcItems }, md, { deadline }, (err, res) => {
        if (err || (res?.failed ?? 0) > 0) {
          this.markFailure(started, false);
          resolve(false);
          return;
        }
        this.markSuccess(started);
        resolve(true);
      });
    });
  }
}
