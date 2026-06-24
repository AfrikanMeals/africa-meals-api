import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import {
  assertGrpcInternalSecret,
  loadChatV1,
  loadInboxV1,
  parsePositiveInt,
} from '@africa-meals/proto';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { StoreService } from '@modules/store/store.service';

type InboxServer = grpc.UntypedServiceImplementation;
type ChatServer = grpc.UntypedServiceImplementation;

@Injectable()
export class GrpcApiServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrpcApiServerService.name);
  private server: grpc.Server | null = null;
  private internalSecret = '';

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretManagerService,
    private readonly storeService: StoreService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('gRPC API server disabled (GRPC_API_SERVER_ENABLED=false)');
      return;
    }
    this.internalSecret =
      (await this.secrets.resolveString('api', 'INTERNAL_NOTIFY_SECRET')) ||
      this.config.get<string>('GRPC_INTERNAL_SECRET')?.trim() ||
      '';
    if (!this.internalSecret) {
      this.logger.warn('gRPC API server disabled — INTERNAL_NOTIFY_SECRET absent');
      return;
    }

    const port = parsePositiveInt(this.config.get<string>('GRPC_API_PORT'), 50052);
    const host = this.config.get<string>('GRPC_API_BIND_HOST')?.trim() || '0.0.0.0';
    const maxMb = parsePositiveInt(this.config.get<string>('GRPC_MAX_RECV_MB'), 4);

    const inboxPkg = loadInboxV1() as Record<string, unknown>;
    const chatPkg = loadChatV1() as Record<string, unknown>;
    const inboxService = (inboxPkg.wiseeat as Record<string, unknown>)?.inbox as
      | Record<string, unknown>
      | undefined;
    const chatService = (chatPkg.wiseeat as Record<string, unknown>)?.chat as
      | Record<string, unknown>
      | undefined;

    const server = new grpc.Server({
      'grpc.max_receive_message_length': maxMb * 1024 * 1024,
      'grpc.max_send_message_length': maxMb * 1024 * 1024,
    });

    if (inboxService?.v1?.InboxFeedService?.service) {
      server.addService(
        inboxService.v1.InboxFeedService.service as grpc.ServiceDefinition,
        this.buildInboxHandlers() as InboxServer,
      );
    }
    if (chatService?.v1?.ChatPushService?.service) {
      server.addService(
        chatService.v1.ChatPushService.service as grpc.ServiceDefinition,
        this.buildChatHandlers() as ChatServer,
      );
    }

    await new Promise<void>((resolve, reject) => {
      server.bindAsync(
        `${host}:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) {
            reject(err);
            return;
          }
          server.start();
          resolve();
        },
      );
    });
    this.server = server;
    this.logger.log(`gRPC API server listening on ${host}:${port}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server!.tryShutdown(() => resolve());
    });
    this.server = null;
  }

  private isEnabled(): boolean {
    const raw = (this.config.get<string>('GRPC_API_SERVER_ENABLED') ?? 'true')
      .trim()
      .toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  private assertAuth(metadata: grpc.Metadata): boolean {
    return assertGrpcInternalSecret(metadata, this.internalSecret);
  }

  private buildInboxHandlers(): InboxServer {
    return {
      GetVendorFeed: async (call, callback) => {
        if (!this.assertAuth(call.metadata)) {
          callback({ code: grpc.status.UNAUTHENTICATED, message: 'unauthorized' });
          return;
        }
        const userId = String(call.request.userId ?? '').trim();
        try {
          const feed = await this.storeService.findNotificationFeedByUserId(userId);
          callback(null, { feedJson: JSON.stringify(feed ?? { items: [] }) });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          callback(null, { feedJson: JSON.stringify({ items: [], error: msg }) });
        }
      },
    };
  }

  private buildChatHandlers(): ChatServer {
    return {
      NotifyChatMessage: async (call, callback) => {
        if (!this.assertAuth(call.metadata)) {
          callback({ code: grpc.status.UNAUTHENTICATED, message: 'unauthorized' });
          return;
        }
        try {
          const payload = JSON.parse(String(call.request.payloadJson ?? '{}')) as {
            recipientUserIds?: string[];
            title?: string;
            body?: string;
            conversationId?: string;
            storeId?: string;
            storeName?: string;
          };
          await this.notifications.sendChatMessagePush({
            recipientUserIds: payload.recipientUserIds ?? [],
            title: String(payload.title ?? ''),
            body: String(payload.body ?? ''),
            conversationId: String(payload.conversationId ?? ''),
            storeId: payload.storeId,
            storeName: payload.storeName,
          });
          callback(null, { ok: true, error: '' });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          callback(null, { ok: false, error: msg });
        }
      },
    };
  }
}
