import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assertGrpcInternalSecret,
  getProtoServiceDefinition,
  grpc,
  loadCartV1,
  loadChatV1,
  loadInboxV1,
  parsePositiveInt,
} from '@africa-meals/proto';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { StoreService } from '@modules/store/store.service';
import { CartService } from '@modules/cart/cart.service';
import { GrpcVersionService } from './grpc-version.service';
import { InjectModel } from '@nestjs/mongoose';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';

type InboxServer = grpc.UntypedServiceImplementation;
type ChatServer = grpc.UntypedServiceImplementation;
type CartServer = grpc.UntypedServiceImplementation;

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
    private readonly grpcVersion: GrpcVersionService,
    private readonly cartService: CartService,
    @InjectModel(UserModel.name) private readonly userModel: Model<UserModel>,
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

    const inboxPkg = loadInboxV1();
    const chatPkg = loadChatV1();
    const cartPkg = loadCartV1();
    const inboxDef = getProtoServiceDefinition(
      inboxPkg,
      'wiseeat',
      'inbox',
      'v1',
      'InboxFeedService',
    );
    const chatDef = getProtoServiceDefinition(
      chatPkg,
      'wiseeat',
      'chat',
      'v1',
      'ChatPushService',
    );
    const cartDef =
      this.isCartPreviewGrpcEnabled()
        ? getProtoServiceDefinition(
            cartPkg,
            'wiseeat',
            'cart',
            'v1',
            'CartPreviewService',
          )
        : undefined;

    const server = new grpc.Server({
      'grpc.max_receive_message_length': maxMb * 1024 * 1024,
      'grpc.max_send_message_length': maxMb * 1024 * 1024,
    });

    if (inboxDef) {
      server.addService(inboxDef, this.buildInboxHandlers() as InboxServer);
    }
    if (chatDef) {
      server.addService(chatDef, this.buildChatHandlers() as ChatServer);
    }
    if (cartDef) {
      server.addService(cartDef, this.buildCartHandlers() as CartServer);
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
    if (!this.grpcVersion.supportsCoreInternal()) return false;
    const raw = (this.config.get<string>('GRPC_API_SERVER_ENABLED') ?? 'true')
      .trim()
      .toLowerCase();
    return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
  }

  private isCartPreviewGrpcEnabled(): boolean {
    if (!this.grpcVersion.supportsPhase3() || !this.grpcVersion.hasPhase3Implementation()) {
      return false;
    }
    const raw = (this.config.get<string>('GRPC_CART_PREVIEW_GRPC_ENABLED') ?? 'false')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  private async resolveUser(userId: string): Promise<UserModel | null> {
    const uid = userId.trim();
    if (!uid) return null;
    return this.userModel.findById(uid).exec();
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

  private buildCartHandlers(): CartServer {
    return {
      PreviewCoupon: async (call, callback) => {
        if (!this.assertAuth(call.metadata)) {
          callback({ code: grpc.status.UNAUTHENTICATED, message: 'unauthorized' });
          return;
        }
        try {
          const userId = String(call.request.userId ?? '').trim();
          const storeId = String(call.request.storeId ?? '').trim();
          const code = String(call.request.code ?? '').trim();
          const user = await this.resolveUser(userId);
          if (!user) {
            callback(null, { ok: false, resultJson: '', error: 'user_not_found' });
            return;
          }
          const result = await this.cartService.previewCouponForStore(
            user,
            storeId,
            code,
          );
          callback(null, { ok: true, resultJson: JSON.stringify(result), error: '' });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          callback(null, { ok: false, resultJson: '', error: msg });
        }
      },
      PreviewGiftCode: async (call, callback) => {
        if (!this.assertAuth(call.metadata)) {
          callback({ code: grpc.status.UNAUTHENTICATED, message: 'unauthorized' });
          return;
        }
        try {
          const userId = String(call.request.userId ?? '').trim();
          const user = await this.resolveUser(userId);
          if (!user) {
            callback(null, { ok: false, resultJson: '', error: 'user_not_found' });
            return;
          }
          const dto = JSON.parse(String(call.request.payloadJson ?? '{}')) as {
            code?: string;
          };
          const result = await this.cartService.previewGiftCodeForCart(user, {
            code: String(dto.code ?? call.request.code ?? '').trim(),
          });
          callback(null, { ok: true, resultJson: JSON.stringify(result), error: '' });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          callback(null, { ok: false, resultJson: '', error: msg });
        }
      },
    };
  }
}
