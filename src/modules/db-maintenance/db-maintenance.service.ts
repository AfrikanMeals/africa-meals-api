import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import {
  MqttRuntimeStatus,
  WsNotifyDispatchQueueService,
} from '@modules/ws-notify/ws-notify-dispatch-queue.service';
import { PlatformChannelsService } from '@modules/platform-channels/platform-channels.service';
import { InjectConnection } from '@nestjs/mongoose';
import {
  AdCampaignItemTypeEnum,
  AdCampaignModel,
} from '@schemas/ad-campaign.schema';
import { AdNotificationEventModel } from '@schemas/ad-notification-event.schema';
import { AdNotificationPricingSettingsModel } from '@schemas/ad-notification-pricing-settings.schema';
import { AdModel, StoreAdActionTypeEnum } from '@schemas/ad.schema';
import {
  parseAvailableChannelsFromDoc,
  type AdNotificationChannelAvailability,
} from '@modules/ads/ad-notification-channel-availability.util';
import {
  audienceTotalFromDoc,
  notificationAddonFromDoc,
} from '@modules/ads/ad-notification.util';
import {
  channelHealthSummary,
  evaluateAdNotificationChannelHealth,
} from '@modules/db-maintenance/ad-notification-channel-health.util';
import {
  isAdNotificationSmsEnabled,
  isAdNotificationWhatsAppEnabled,
  probeBirdChannelApi,
  readBirdSmsConfig,
  readBirdWhatsAppConfig,
} from '@modules/ads/bird-channels.util';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import { DrinkModel } from '@schemas/drink.schema';
import { InfraRuntimeSettingsModel } from '@schemas/infra-runtime-settings.schema';
import { OfferModel, OfferStatusEnum } from '@schemas/offer.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import {
  RECOMMENDATION_GLOBAL_SNAPSHOT_KEY,
  RecommendationTrainingSnapshotModel,
} from '@schemas/recommendation-training-snapshot.schema';
import {
  StoreCouponDiscountTypeEnum,
  StoreCouponModel,
} from '@schemas/store_coupon.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserRecommendationDigestModel } from '@schemas/user-recommendation-digest.schema';
import { StripeProcessedCheckoutModel } from '@schemas/stripe-processed-checkout.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { loadFirebaseServiceAccount } from 'src/config/firebase-env';
import { Connection, Model, Types } from 'mongoose';
import { StoreAccessService } from '../teams/store-access.service';
import {
  OrderPaidInvoiceEmailService,
  type OrderEmailDebugSendResult,
  type OrderEmailVariant,
} from '@modules/orders/order-paid-invoice-email.service';
import { orderInvoiceRef } from '@modules/orders/order-invoice.util';
import { InjectModel } from '@nestjs/mongoose';
import { SendOrderEmailDebugDto } from './dto/send-order-email-debug.dto';
import { GrpcWsNotifyMetricsService } from '@modules/grpc/grpc-ws-notify.metrics.service';
import { buildSystemExchangeResponse } from './system-exchange.builder';
import {
  grpcEnvFlag,
  probeBullmqRedis,
  probeCacheRedis,
  probeGrpcApiInternal,
  probeGrpcWsNotify,
  probeMemcached,
  resolveMinioHealthProbeSkipReason,
} from './system-exchange.probes';
import type { SystemExchangeResponse, WsGrpcRuntimeStatus } from './system-exchange.types';
import { MapSettingsService } from '@modules/map-settings/map-settings.service';
import { osmForwardGeocode } from '@common/osm-geocoding.util';
import Stripe = require('stripe');
import { randomUUID } from 'crypto';
import { AdminJobEmitterService } from '@modules/admin-jobs/admin-job-emitter.service';
import { StripeWebhookMetricsService } from '@modules/billing/stripe/stripe-webhook-metrics.service';
import {
  DB_CLEARABLE_TABLES,
  DbClearableTableCategory,
  DbClearableTableDef,
  getClearableTable,
  isClearableTableKey,
} from './db-clearable-tables';

export type DbTableListItem = {
  key: string;
  collection: string;
  labelFr: string;
  labelEn: string;
  category: DbClearableTableCategory;
  critical: boolean;
  documentCount: number;
};

export type ClearDbTablesResult = {
  cleared: Array<{ key: string; collection: string; deletedCount: number }>;
};

export type IntegrityTestDefinition = {
  key: string;
  label: string;
  description: string;
};

export type IntegrityTestRunResult = {
  key: string;
  label: string;
  totalEvaluateTimeMs: number;
  successRuns: number;
  totalRuns: number;
  score: number;
  confidence: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  summary: string;
  checkedAt: string;
  failureReasonCounts: Array<{ reason: string; count: number }>;
  sampleFailures: Array<{
    orderId: string;
    issues: string[];
  }>;
};

export type SystemHealthCheckDefinition = {
  key: string;
  label: string;
  description: string;
};

export type SystemHealthCheckResult = {
  key: string;
  label: string;
  totalEvaluateTimeMs: number;
  status: 'healthy' | 'degraded' | 'down';
  score: number;
  confidence: number;
  details: string;
  checkedAt: string;
};

export type InfraRuntimeSettingsResponse = {
  redisManagerEnabled: boolean;
  mqBrokerEnabled: boolean;
  grpcWsNotifyEnabled: boolean;
  updatedAt: string | null;
};

export type InfraCacheEngineLiveStatus = {
  engine: 'redis' | 'memcached';
  state: 'disabled' | 'healthy' | 'degraded' | 'down';
  latencyMs: number | null;
  details: string;
};

export type InfraCacheLiveStatusResponse = {
  redis: InfraCacheEngineLiveStatus;
  memcached: InfraCacheEngineLiveStatus;
  checkedAt: string;
};
export type InfraMqttStatusResponse = {
  apiPublisher: MqttRuntimeStatus;
  wsSubscriber: MqttRuntimeStatus & { source: 'ws-internal' | 'unknown' };
  checkedAt: string;
};

const INFRA_RUNTIME_SETTINGS_KEY = 'default';

@Injectable()
export class DbMaintenanceService {
  private readonly logger = new Logger(DbMaintenanceService.name);
  private readonly stripeFactory = Stripe;
  private readonly integrityTests: IntegrityTestDefinition[] = [
    {
      key: 'order-payment-test',
      label: 'Order Payment Test',
      description:
        'Vérifie toutes les commandes marquées payées: transaction Stripe liée, montants et statut.',
    },
    {
      key: 'order-data-safety-test',
      label: 'Order Data Safety Test',
      description:
        'Vérifie la cohérence des commandes (total, items, flux livraison/retrait, lien paiement).',
    },
    {
      key: 'stripe-processed-checkout-test',
      label: 'Stripe Processed Checkout Test',
      description:
        'Vérifie la qualité des enregistrements stripe_processed_checkouts (session, montants, breakdown).',
    },
    {
      key: 'stuck-created-orders-test',
      label: 'Stuck Created Orders Test',
      description:
        'Détecte les commandes restant trop longtemps en statut created (risque incident checkout/webhook).',
    },
    {
      key: 'operational-guards-test',
      label: 'Operational Guards Test',
      description:
        'Vérifie des garde-fous critiques de configuration (JWT, Stripe webhook, reCAPTCHA monitor/enforce).',
    },
    {
      key: 'subscription-restrictions-test',
      label: 'Subscription Restrictions Test',
      description:
        "Vérifie les quotas d'abonnement: max boutiques par vendeur et max catalogue par boutique.",
    },
    {
      key: 'subscription-downgrade-impact-test',
      label: 'Subscription Downgrade Impact Test',
      description:
        'Mesure l’impact potentiel de downgrade par vendeur (boutiques/articles qui deviendraient masqués).',
    },
    {
      key: 'ads-integrity-test',
      label: 'Ads Integrity Test',
      description:
        'Vérifie bannières et campagnes (dates, cibles, add-on notifications, canaux vs disponibilité admin, événements orphelins).',
    },
    {
      key: 'coupon-codes-integrity-test',
      label: 'Coupon Codes Integrity Test',
      description:
        'Vérifie la cohérence des codes promo (format, période de validité, quotas, boutique liée).',
    },
    {
      key: 'cart-features-integrity-test',
      label: 'Cart Features Integrity Test',
      description:
        'Vérifie les lignes panier (type, quantité, prix, boutique/utilisateur liés, entités catalogue valides).',
    },
    {
      key: 'product-recommendations-integrity-test',
      label: 'Product Recommendations Integrity Test',
      description:
        'Vérifie le snapshot tendances, la fraîcheur du job et la cohérence des digests utilisateur.',
    },
    {
      key: 'catalog-loading-integrity-test',
      label: 'Catalog Loading Integrity Test',
      description:
        'Vérifie que produits et boissons actifs sont chargeables (champs requis, boutique active, visuels).',
    },
    {
      key: 'store-detail-page-integrity-test',
      label: 'Store Detail Page Integrity Test',
      description:
        'Vérifie les boutiques actives pour l’écran menu (méta publique, adresse, contact, devise).',
    },
    {
      key: 'platform-readiness-integrity-test',
      label: 'Platform Readiness Integrity Test',
      description:
        'Contrôles transverses : offres actives, catalogues vides, incohérences boutique ↔ articles.',
    },
  ];
  private readonly systemHealthChecks: SystemHealthCheckDefinition[] = [
    {
      key: 'mongodb-status',
      label: 'MongoDB status',
      description: 'Vérifie la connectivité MongoDB via ping.',
    },
    {
      key: 'redis-cache-status',
      label: 'Redis cache status',
      description:
        'Vérifie Redis cache + pub/sub SSE (REDIS_*) via PING.',
    },
    {
      key: 'bullmq-redis-status',
      label: 'Redis BullMQ status',
      description:
        'Vérifie Redis files BullMQ (BULLMQ_REDIS_* ou repli REDIS_*) via PING.',
    },
    {
      key: 'memcached-status',
      label: 'Memcached status',
      description:
        'Vérifie Memcached (multicache engine) via SET/GET test.',
    },
    {
      key: 'websocket-service-status',
      label: 'Websocket Service status',
      description: 'Vérifie la disponibilité du service WS (/api/health).',
    },
    {
      key: 'grpc-ws-notify-status',
      label: 'gRPC WS Notify status',
      description:
        'Ping NotifyService sur africa-meals-ws (:50051) — canal API → WS gRPC.',
    },
    {
      key: 'grpc-api-internal-status',
      label: 'gRPC API internal status',
      description:
        'Sonde InboxFeedService sur l’API (:50052) — canal WS → API gRPC.',
    },
    {
      key: 'api-function-status',
      label: 'API Function Status',
      description: 'Vérifie l’état global de l’API (uptime + ping DB).',
    },
    {
      key: 'stripe-payment-status',
      label: 'Stripe payment Status',
      description: 'Vérifie la connectivité Stripe via balance.retrieve.',
    },
    {
      key: 'stripe-webhook-last-activity',
      label: 'Webhook Stripe last activity',
      description:
        'Vérifie la dernière activité de traitement Stripe et son ancienneté.',
    },
    {
      key: 'stripe-webhook-latency',
      label: 'Webhook Stripe latency (p95)',
      description:
        'Mesure p95 du temps de réponse HTTP ack webhook Stripe (fenêtre glissante in-process).',
    },
    {
      key: 'map-engine-status',
      label: 'Map Engine Status',
      description:
        'Vérifie Mapbox, Google Maps et OpenStreetMap (Nominatim) + config plateforme.',
    },
    {
      key: 'mail-health-status',
      label: 'Mail health status',
      description:
        'Multimoteur email : config et santé de chaque moteur (SMTP, Bird, Resend, SendGrid, etc.).',
    },
    {
      key: 'firebase-services-status',
      label: 'Firebase services status',
      description:
        'Vérifie Firebase Admin (Auth, Messaging, Storage) avec les credentials actifs.',
    },
    {
      key: 'ad-notification-channels-status',
      label: 'Ad notification channels status',
      description:
        'Vérifie la disponibilité admin des canaux notifications Ads et la configuration runtime (SMTP, FCM, SMS/WhatsApp, Redis, cron).',
    },
    {
      key: 'bird-sms-api-status',
      label: 'SMS API status',
      description:
        'Vérifie le canal SMS pour notifications Ads et vendeurs.',
    },
    {
      key: 'bird-whatsapp-api-status',
      label: 'WhatsApp API status',
      description:
        'Vérifie le canal WhatsApp pour notifications Ads.',
    },
  ];

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly storeAccess: StoreAccessService,
    private readonly subscriptionsService: SubscriptionsService,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedModel: Model<StripeProcessedCheckoutModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    @InjectModel(DrinkModel.name)
    private readonly drinkModel: Model<DrinkModel>,
    @InjectModel(AdModel.name)
    private readonly adModel: Model<AdModel>,
    @InjectModel(AdCampaignModel.name)
    private readonly adCampaignModel: Model<AdCampaignModel>,
    @InjectModel(AdNotificationPricingSettingsModel.name)
    private readonly adNotificationPricingModel: Model<AdNotificationPricingSettingsModel>,
    @InjectModel(AdNotificationEventModel.name)
    private readonly adNotificationEventModel: Model<AdNotificationEventModel>,
    @InjectModel(StoreCouponModel.name)
    private readonly couponModel: Model<StoreCouponModel>,
    @InjectModel(CartItemModel.name)
    private readonly cartItemModel: Model<CartItemModel>,
    @InjectModel(OfferModel.name)
    private readonly offerModel: Model<OfferModel>,
    @InjectModel(RecommendationTrainingSnapshotModel.name)
    private readonly recommendationSnapshotModel: Model<RecommendationTrainingSnapshotModel>,
    @InjectModel(UserRecommendationDigestModel.name)
    private readonly userRecommendationDigestModel: Model<UserRecommendationDigestModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(InfraRuntimeSettingsModel.name)
    private readonly infraRuntimeSettingsModel: Model<InfraRuntimeSettingsModel>,
    @Inject('FIREBASE_ADMIN')
    private readonly firebaseApp: App,
    private readonly wsNotifyDispatchQueue: WsNotifyDispatchQueueService,
    private readonly platformChannels: PlatformChannelsService,
    private readonly mapSettings: MapSettingsService,
    private readonly orderPaidInvoiceEmail: OrderPaidInvoiceEmailService,
    private readonly grpcWsNotifyMetrics: GrpcWsNotifyMetricsService,
    @Inject(forwardRef(() => AdminJobEmitterService))
    @Optional()
    private readonly adminJobEmitter?: AdminJobEmitterService,
    @Inject(forwardRef(() => StripeWebhookMetricsService))
    @Optional()
    private readonly stripeWebhookMetrics?: StripeWebhookMetricsService,
  ) {}

  private assertMaintenanceEnabled(): void {
    const raw = this.config.get<string>('ALLOW_DB_MAINTENANCE');
    const normalized = String(raw ?? '')
      .trim()
      .toLowerCase();
    if (normalized === 'false' || normalized === '0') {
      throw new ForbiddenException('db_maintenance_disabled');
    }
    const nodeEnv = String(
      this.config.get('NODE_ENV') ?? process.env.NODE_ENV ?? '',
    )
      .trim()
      .toLowerCase();
    if (
      nodeEnv === 'production' &&
      normalized !== 'true' &&
      normalized !== '1'
    ) {
      throw new ForbiddenException('db_maintenance_disabled');
    }
  }

  async assertAdminMaintainer(user: UserModel): Promise<void> {
    await this.assertAdminSettingsPermission(user);
    this.assertMaintenanceEnabled();
  }

  async assertAdminSettingsPermission(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  async listTables(user: UserModel): Promise<{ tables: DbTableListItem[] }> {
    await this.assertAdminMaintainer(user);
    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('database_unavailable');
    }

    const tables: DbTableListItem[] = [];
    for (const def of DB_CLEARABLE_TABLES) {
      const documentCount = await this.countCollection(db, def);
      tables.push(this.toListItem(def, documentCount));
    }
    return { tables };
  }

  async clearTables(
    user: UserModel,
    keys: string[],
  ): Promise<ClearDbTablesResult> {
    await this.assertAdminMaintainer(user);

    const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('no_tables_selected');
    }
    for (const key of unique) {
      if (!isClearableTableKey(key)) {
        throw new BadRequestException(`unknown_table:${key}`);
      }
    }

    const db = this.connection.db;
    if (!db) {
      throw new BadRequestException('database_unavailable');
    }

    const cleared: ClearDbTablesResult['cleared'] = [];
    for (const key of unique) {
      const def = getClearableTable(key)!;
      const res = await db.collection(def.collection).deleteMany({});
      const deletedCount = res.deletedCount ?? 0;
      cleared.push({
        key: def.key,
        collection: def.collection,
        deletedCount,
      });
      this.logger.warn(
        `DB maintenance: ${user.id} cleared ${def.collection} (${deletedCount} doc(s))`,
      );
    }

    return { cleared };
  }

  async clearTablesAsync(
    user: UserModel,
    keys: string[],
  ): Promise<{ jobId: string }> {
    await this.assertAdminMaintainer(user);
    const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('no_tables_selected');
    }
    for (const key of unique) {
      if (!isClearableTableKey(key)) {
        throw new BadRequestException(`unknown_table:${key}`);
      }
    }
    const jobId = randomUUID();
    void this.runClearTablesJob(user, unique, jobId).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`clearTablesAsync job ${jobId} failed: ${msg}`);
      void this.adminJobEmitter?.emitFailed({
        jobId,
        error: msg,
      });
    });
    return { jobId };
  }

  private async runClearTablesJob(
    user: UserModel,
    keys: string[],
    jobId: string,
  ): Promise<void> {
    const db = this.connection.db;
    if (!db) {
      await this.adminJobEmitter?.emitFailed({
        jobId,
        error: 'database_unavailable',
      });
      return;
    }

    const total = keys.length;
    const cleared: ClearDbTablesResult['cleared'] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const def = getClearableTable(key)!;
      await this.adminJobEmitter?.emitProgress({
        jobId,
        pct: Math.round((i / total) * 100),
        label: def.labelFr,
        phase: key,
      });
      const res = await db.collection(def.collection).deleteMany({});
      const deletedCount = res.deletedCount ?? 0;
      cleared.push({
        key: def.key,
        collection: def.collection,
        deletedCount,
      });
      this.logger.warn(
        `DB maintenance async: ${user.id} cleared ${def.collection} (${deletedCount} doc(s))`,
      );
    }

    await this.adminJobEmitter?.emitCompleted({
      jobId,
      result: { cleared },
    });
  }

  async listIntegrityTests(
    user: UserModel,
  ): Promise<{ tests: IntegrityTestDefinition[] }> {
    await this.assertAdminSettingsPermission(user);
    return { tests: this.integrityTests };
  }

  async runIntegrityTest(
    user: UserModel,
    key: string,
  ): Promise<{ result: IntegrityTestRunResult }> {
    await this.assertAdminSettingsPermission(user);
    const normalized = String(key || '')
      .trim()
      .toLowerCase();
    switch (normalized) {
      case 'order-payment-test':
        return { result: await this.runOrderPaymentIntegrityTest() };
      case 'order-data-safety-test':
        return { result: await this.runOrderDataSafetyIntegrityTest() };
      case 'stripe-processed-checkout-test':
        return { result: await this.runStripeProcessedCheckoutIntegrityTest() };
      case 'stuck-created-orders-test':
        return { result: await this.runStuckCreatedOrdersIntegrityTest() };
      case 'operational-guards-test':
        return { result: await this.runOperationalGuardsIntegrityTest() };
      case 'subscription-restrictions-test':
        return {
          result: await this.runSubscriptionRestrictionsIntegrityTest(),
        };
      case 'subscription-downgrade-impact-test':
        return {
          result: await this.runSubscriptionDowngradeImpactIntegrityTest(),
        };
      case 'ads-integrity-test':
        return { result: await this.runAdsIntegrityTest() };
      case 'coupon-codes-integrity-test':
        return { result: await this.runCouponCodesIntegrityTest() };
      case 'cart-features-integrity-test':
        return { result: await this.runCartFeaturesIntegrityTest() };
      case 'product-recommendations-integrity-test':
        return { result: await this.runProductRecommendationsIntegrityTest() };
      case 'catalog-loading-integrity-test':
        return { result: await this.runCatalogLoadingIntegrityTest() };
      case 'store-detail-page-integrity-test':
        return { result: await this.runStoreDetailPageIntegrityTest() };
      case 'platform-readiness-integrity-test':
        return { result: await this.runPlatformReadinessIntegrityTest() };
      default:
        throw new BadRequestException(`unknown_integrity_test:${normalized}`);
    }
  }

  async listSystemHealthChecks(
    user: UserModel,
  ): Promise<{ checks: SystemHealthCheckDefinition[] }> {
    await this.assertAdminSettingsPermission(user);
    return { checks: this.systemHealthChecks };
  }

  async runAllSystemHealthChecksInternal(): Promise<SystemHealthCheckResult[]> {
    return Promise.all(
      this.systemHealthChecks.map((def) =>
        this.runSystemHealthCheckInternal(def.key),
      ),
    );
  }

  /** Sondes infra exposées sur la page statut publique (sans auth). */
  async runPublicSystemHealthCheck(
    key: string,
  ): Promise<SystemHealthCheckResult> {
    return this.runSystemHealthCheckInternal(key);
  }

  private async runSystemHealthCheckInternal(
    key: string,
  ): Promise<SystemHealthCheckResult> {
    const normalized = String(key || '')
      .trim()
      .toLowerCase();
    switch (normalized) {
      case 'mongodb-status':
        return this.runMongoHealthCheck();
      case 'redis-cache-status':
        return this.runRedisCacheHealthCheck();
      case 'bullmq-redis-status':
        return this.runBullmqRedisHealthCheck();
      case 'memcached-status':
        return this.runMemcachedHealthCheck();
      case 'websocket-service-status':
        return this.runWebsocketHealthCheck();
      case 'grpc-ws-notify-status':
        return this.runGrpcWsNotifyHealthCheck();
      case 'grpc-api-internal-status':
        return this.runGrpcApiInternalHealthCheck();
      case 'api-function-status':
        return this.runApiFunctionHealthCheck();
      case 'stripe-payment-status':
        return this.runStripeHealthCheck();
      case 'stripe-webhook-last-activity':
        return this.runStripeWebhookLastActivityHealthCheck();
      case 'stripe-webhook-latency':
        return this.runStripeWebhookLatencyHealthCheck();
      case 'map-engine-status':
        return this.runMapEngineHealthCheck();
      case 'file-storage-engines-status':
        return this.runFileStorageEnginesHealthCheck();
      case 'mail-health-status':
        return this.runMailHealthCheck();
      case 'firebase-services-status':
        return this.runFirebaseServicesHealthCheck();
      case 'ad-notification-channels-status':
        return this.runAdNotificationChannelsHealthCheck();
      case 'bird-sms-api-status':
        return this.runBirdSmsApiHealthCheck();
      case 'bird-whatsapp-api-status':
        return this.runBirdWhatsAppApiHealthCheck();
      default:
        throw new BadRequestException(
          `unknown_system_health_check:${normalized}`,
        );
    }
  }

  async runSystemHealthCheck(
    user: UserModel,
    key: string,
  ): Promise<{ result: SystemHealthCheckResult }> {
    await this.assertAdminSettingsPermission(user);
    return {
      result: await this.runSystemHealthCheckInternal(key),
    };
  }

  async getInfraRuntimeSettings(
    user: UserModel,
  ): Promise<InfraRuntimeSettingsResponse> {
    await this.assertAdminSettingsPermission(user);
    const doc = await this.ensureInfraRuntimeSettings();
    return this.toInfraRuntimeSettingsResponse(doc);
  }

  async updateInfraRuntimeSettings(
    user: UserModel,
    input: {
      redisManagerEnabled: boolean;
      mqBrokerEnabled: boolean;
      grpcWsNotifyEnabled: boolean;
    },
  ): Promise<InfraRuntimeSettingsResponse> {
    await this.assertAdminSettingsPermission(user);
    const updated = await this.infraRuntimeSettingsModel
      .findOneAndUpdate(
        { key: INFRA_RUNTIME_SETTINGS_KEY },
        {
          $set: {
            redisManagerEnabled: input.redisManagerEnabled === true,
            mqBrokerEnabled: input.mqBrokerEnabled === true,
            grpcWsNotifyEnabled: input.grpcWsNotifyEnabled === true,
          },
          $setOnInsert: { key: INFRA_RUNTIME_SETTINGS_KEY },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toInfraRuntimeSettingsResponse(updated);
  }

  async getInfraCacheLiveStatus(
    user: UserModel,
  ): Promise<InfraCacheLiveStatusResponse> {
    await this.assertAdminSettingsPermission(user);
    return this.getInfraCacheLiveStatusInternal();
  }

  /** Usage interne (dashboard admin / SSE). */
  async getInfraCacheLiveStatusInternal(): Promise<InfraCacheLiveStatusResponse> {
    const [redisProbe, memcachedProbe] = await Promise.all([
      probeCacheRedis(this.config),
      probeMemcached(this.config),
    ]);
    const mapState = (
      status: string,
    ): InfraCacheEngineLiveStatus['state'] => {
      if (status === 'healthy') return 'healthy';
      if (status === 'degraded') return 'degraded';
      if (status === 'disabled') return 'disabled';
      return 'down';
    };
    return {
      redis: {
        engine: 'redis',
        state: mapState(redisProbe.status),
        latencyMs: redisProbe.latencyMs,
        details: redisProbe.details,
      },
      memcached: {
        engine: 'memcached',
        state: mapState(memcachedProbe.status),
        latencyMs: memcachedProbe.latencyMs,
        details: memcachedProbe.details,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  async getInfraMqttStatus(user: UserModel): Promise<InfraMqttStatusResponse> {
    await this.assertAdminSettingsPermission(user);
    return this.getInfraMqttStatusInternal();
  }

  /** Usage interne (flux SSE admin authentifié). */
  async getInfraMqttStatusInternal(): Promise<InfraMqttStatusResponse> {
    const apiPublisher = this.wsNotifyDispatchQueue.getMqttStatus();
    const wsSubscriber = await this.fetchWsMqttStatus();
    return {
      apiPublisher,
      wsSubscriber,
      checkedAt: new Date().toISOString(),
    };
  }

  async getSystemExchangeStatus(
    user: UserModel,
  ): Promise<SystemExchangeResponse> {
    await this.assertAdminSettingsPermission(user);
    const [mqtt, runtime, firebaseMessagingOk, wsGrpc] = await Promise.all([
      this.getInfraMqttStatusInternal(),
      this.ensureInfraRuntimeSettings().then((doc) =>
        this.toInfraRuntimeSettingsResponse(doc),
      ),
      this.isFirebaseMessagingReady(),
      this.fetchWsGrpcStatus(),
    ]);
    return buildSystemExchangeResponse({
      config: this.config,
      connection: this.connection,
      mqtt,
      runtime,
      wsGrpc,
      firebaseMessagingOk,
    });
  }

  /** Usage interne (flux SSE admin authentifié). */
  async getInfraRuntimeSettingsInternal(): Promise<InfraRuntimeSettingsResponse> {
    const doc = await this.ensureInfraRuntimeSettings();
    return this.toInfraRuntimeSettingsResponse(doc);
  }

  private async ensureInfraRuntimeSettings(): Promise<InfraRuntimeSettingsModel> {
    const doc = await this.infraRuntimeSettingsModel
      .findOneAndUpdate(
        { key: INFRA_RUNTIME_SETTINGS_KEY },
        {
          $setOnInsert: {
            key: INFRA_RUNTIME_SETTINGS_KEY,
            redisManagerEnabled: true,
            mqBrokerEnabled: true,
            grpcWsNotifyEnabled: false,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc;
  }

  private toInfraRuntimeSettingsResponse(
    doc: InfraRuntimeSettingsModel,
  ): InfraRuntimeSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      redisManagerEnabled: doc.redisManagerEnabled === true,
      mqBrokerEnabled: doc.mqBrokerEnabled === true,
      grpcWsNotifyEnabled: doc.grpcWsNotifyEnabled === true,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  private async fetchWsMqttStatus(): Promise<
    MqttRuntimeStatus & { source: 'ws-internal' | 'unknown' }
  > {
    const fallback: MqttRuntimeStatus & { source: 'ws-internal' | 'unknown' } =
      {
        enabled: false,
        state: 'error',
        lastError: 'ws_status_unreachable',
        lastTopicSeen: null,
        lastMessageAt: null,
        source: 'unknown',
      };
    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) return fallback;
    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/mqtt/status`
      : `${base}/api/internal/mqtt/status`;
    try {
      const response = await this.fetchWithTimeout(path, 5000, {
        method: 'GET',
        headers: {
          'X-Internal-Secret': secret,
        },
      });
      if (!response.ok) {
        return {
          ...fallback,
          lastError: `ws_status_http_${response.status}`,
        };
      }
      const data = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return {
        enabled: data.enabled !== false,
        state:
          data.state === 'disabled' ||
          data.state === 'connecting' ||
          data.state === 'connected' ||
          data.state === 'reconnecting' ||
          data.state === 'error'
            ? data.state
            : 'error',
        lastError: typeof data.lastError === 'string' ? data.lastError : null,
        lastTopicSeen:
          typeof data.lastTopicSeen === 'string' ? data.lastTopicSeen : null,
        lastMessageAt:
          typeof data.lastMessageAt === 'string' ? data.lastMessageAt : null,
        source: 'ws-internal',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint =
        msg === 'fetch failed'
          ? `ws_status_unreachable (${raw}) — vérifiez que we-ws-dev écoute sur ce port`
          : msg;
      return {
        ...fallback,
        lastError: hint,
      };
    }
  }

  private async fetchWsGrpcStatus(): Promise<WsGrpcRuntimeStatus> {
    const fallback: WsGrpcRuntimeStatus = {
      wsToApiEnabled: false,
      wsServerEnabled: false,
      apiHost: '127.0.0.1',
      apiPort: 50052,
      clientsReady: false,
      httpFallbackEnabled: true,
      lastError: 'ws_grpc_status_unreachable',
      source: 'unknown',
    };
    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) return fallback;
    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/grpc/status`
      : `${base}/api/internal/grpc/status`;
    try {
      const response = await this.fetchWithTimeout(path, 5000, {
        method: 'GET',
        headers: {
          'X-Internal-Secret': secret,
        },
      });
      if (!response.ok) {
        return {
          ...fallback,
          lastError: `ws_grpc_status_http_${response.status}`,
        };
      }
      const data = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return {
        wsToApiEnabled: data.wsToApiEnabled === true,
        wsServerEnabled: data.wsServerEnabled === true,
        apiHost:
          typeof data.apiHost === 'string' && data.apiHost.trim()
            ? data.apiHost.trim()
            : '127.0.0.1',
        apiPort:
          typeof data.apiPort === 'number' && Number.isFinite(data.apiPort)
            ? data.apiPort
            : 50052,
        clientsReady: data.clientsReady === true,
        httpFallbackEnabled: data.httpFallbackEnabled !== false,
        lastError:
          typeof data.lastError === 'string' && data.lastError.trim()
            ? data.lastError.trim()
            : null,
        source: 'ws-internal',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint =
        msg === 'fetch failed'
          ? `ws_grpc_status_unreachable (${raw}) — vérifiez que le WS écoute sur ce port`
          : msg;
      return {
        ...fallback,
        lastError: hint,
      };
    }
  }

  private async runOrderPaymentIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const label = 'Order Payment Test';

    const paidOrders = await this.orderModel
      .find({ status: OrderStatusEnum.PAIED })
      .select([
        '_id',
        'status',
        'stripeParentPaymentId',
        'totalPrice',
        'stripeChargedGoodsCents',
        'stripeChargedShipCents',
      ])
      .lean()
      .exec();

    const totalRuns = paidOrders.length;
    if (!totalRuns) {
      return this.decorateIntegrityResult({
        key: 'order-payment-test',
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary: 'Aucune commande marquée payée à vérifier.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      });
    }

    const paymentIds = [
      ...new Set(
        paidOrders
          .map((o) =>
            String(
              (o as { stripeParentPaymentId?: unknown })
                .stripeParentPaymentId ?? '',
            ).trim(),
          )
          .filter((x) => x.length > 0),
      ),
    ];

    const processedDocs = await this.processedModel
      .find({ sessionId: { $in: paymentIds } })
      .select([
        'sessionId',
        'orderIds',
        'perStoreBreakdown',
        'amountTotalCents',
      ])
      .lean()
      .exec();
    const processedByPaymentId = new Map(
      processedDocs.map((d) => [String(d.sessionId), d]),
    );

    const stripeByPaymentId = await this.fetchStripePaymentsById(paymentIds);
    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    let remoteStatusChecked = 0;

    for (const order of paidOrders) {
      const orderId = String(order._id);
      const issues: string[] = [];
      const paymentId = String(
        (order as { stripeParentPaymentId?: unknown }).stripeParentPaymentId ??
          '',
      ).trim();

      if (!paymentId) {
        issues.push('missing_stripe_parent_payment_id');
      }

      const expectedOrderCents = Math.round(
        Number((order as { totalPrice?: unknown }).totalPrice ?? 0) * 100,
      );

      if (paymentId) {
        const processed = processedByPaymentId.get(paymentId);
        if (!processed) {
          issues.push('missing_stripe_processed_checkout');
        } else {
          const orderIds = Array.isArray(processed.orderIds)
            ? processed.orderIds.map((x) => String(x))
            : [];
          const inOrderIds = orderIds.includes(orderId);
          const inBreakdown = Array.isArray(processed.perStoreBreakdown)
            ? processed.perStoreBreakdown.some(
                (row) =>
                  String((row as { orderId?: unknown }).orderId ?? '') ===
                  orderId,
              )
            : false;
          if (!inOrderIds && !inBreakdown) {
            issues.push('order_not_linked_in_processed_checkout');
          }
          if (
            typeof processed.amountTotalCents === 'number' &&
            processed.amountTotalCents > 0 &&
            expectedOrderCents > processed.amountTotalCents
          ) {
            issues.push('order_amount_exceeds_parent_payment');
          }
        }

        const stripeTx = stripeByPaymentId.get(paymentId);
        if (!stripeTx) {
          issues.push('missing_stripe_transaction');
        } else {
          remoteStatusChecked += 1;
          if (!stripeTx.isPaid) {
            issues.push(`stripe_status_not_paid:${stripeTx.status}`);
          }
          if (
            typeof stripeTx.amountCents === 'number' &&
            stripeTx.amountCents > 0 &&
            expectedOrderCents > stripeTx.amountCents
          ) {
            issues.push('order_amount_exceeds_stripe_amount');
          }
        }
      }

      const chargedGoods = Number(
        (order as { stripeChargedGoodsCents?: unknown })
          .stripeChargedGoodsCents ?? 0,
      );
      const chargedShip = Number(
        (order as { stripeChargedShipCents?: unknown })
          .stripeChargedShipCents ?? 0,
      );
      const chargedTotal = chargedGoods + chargedShip;
      if (chargedTotal <= 0) {
        issues.push('missing_charged_amount_fields');
      } else if (Math.abs(chargedTotal - expectedOrderCents) > 1) {
        issues.push('charged_amount_mismatch');
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({ orderId, issues });
      }
    }

    const scoreRaw = (successRuns / totalRuns) * 100;
    const score = Number(scoreRaw.toFixed(2));
    const coverage = remoteStatusChecked / totalRuns;
    const failureRate = 1 - successRuns / totalRuns;
    const confidenceRaw = (0.55 * coverage + 0.45 * (1 - failureRate)) * 100;
    const confidence = Math.max(
      35,
      Math.min(99, Number(confidenceRaw.toFixed(2))),
    );

    return this.decorateIntegrityResult({
      key: 'order-payment-test',
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary: `${successRuns}/${totalRuns} commandes payées valides`,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runOrderDataSafetyIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'order-data-safety-test';
    const label = 'Order Data Safety Test';
    const scanLimit = this.getIntegrityScanLimit();
    const paidLike = [
      OrderStatusEnum.PAIED,
      OrderStatusEnum.APPROVED,
      OrderStatusEnum.SHIPPED,
      OrderStatusEnum.COMPLETED,
    ];

    const totalOrders = await this.orderModel.countDocuments({});
    const docs = await this.orderModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(scanLimit)
      .select([
        '_id',
        'status',
        'totalPrice',
        'items',
        'stripeParentPaymentId',
        'shouldShip',
        'shippingPrice',
        'deliveryAddress',
        'deliveryAddressSnapshot',
      ])
      .lean()
      .exec();

    let successRuns = 0;
    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];

    for (const order of docs) {
      const orderId = String(order._id);
      const issues: string[] = [];
      const status = String((order as { status?: unknown }).status ?? '');
      const totalPrice = Number(
        (order as { totalPrice?: unknown }).totalPrice ?? 0,
      );
      const shouldShip = Boolean(
        (order as { shouldShip?: unknown }).shouldShip,
      );
      const shippingPrice = Number(
        (order as { shippingPrice?: unknown }).shippingPrice ?? 0,
      );
      const stripeParentPaymentId = String(
        (order as { stripeParentPaymentId?: unknown }).stripeParentPaymentId ??
          '',
      ).trim();
      const items = Array.isArray((order as { items?: unknown }).items)
        ? (order as { items: Array<Record<string, unknown>> }).items ?? []
        : [];

      if (totalPrice <= 0) {
        issues.push('non_positive_total_price');
      }
      if (!items.length) {
        issues.push('missing_order_items');
      } else {
        for (const [idx, item] of items.entries()) {
          const q = Number(item.quantity ?? 0);
          const p = Number(item.price ?? 0);
          if (!Number.isFinite(q) || q <= 0) {
            issues.push(`invalid_item_quantity:${idx}`);
            break;
          }
          if (!Number.isFinite(p) || p < 0) {
            issues.push(`invalid_item_price:${idx}`);
            break;
          }
        }
      }

      if (
        paidLike.includes(status as OrderStatusEnum) &&
        !stripeParentPaymentId
      ) {
        issues.push('paid_like_status_without_stripe_parent_payment_id');
      }

      const hasDeliveryAddress = Boolean(
        (order as { deliveryAddress?: unknown }).deliveryAddress,
      );
      const hasDeliverySnapshot = Boolean(
        (order as { deliveryAddressSnapshot?: unknown })
          .deliveryAddressSnapshot,
      );
      if (shouldShip) {
        if (!hasDeliveryAddress && !hasDeliverySnapshot) {
          issues.push('shipping_order_missing_delivery_address');
        }
        if (shippingPrice <= 0) {
          issues.push('shipping_order_non_positive_shipping_price');
        }
      } else if (shippingPrice > 0) {
        issues.push('pickup_order_has_shipping_price');
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({ orderId, issues });
      }
    }

    const totalRuns = docs.length;
    const score = totalRuns
      ? Number(((successRuns / totalRuns) * 100).toFixed(2))
      : 100;
    const confidence = Number(
      Math.min(99, 60 + Math.min(totalRuns, 3000) / 50).toFixed(2),
    );
    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary:
        totalOrders > scanLimit
          ? `${successRuns}/${totalRuns} valides (scan limité aux ${scanLimit} commandes les plus récentes sur ${totalOrders}).`
          : `${successRuns}/${totalRuns} commandes valides.`,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runStripeProcessedCheckoutIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'stripe-processed-checkout-test';
    const label = 'Stripe Processed Checkout Test';
    const scanLimit = this.getIntegrityScanLimit();
    const totalDocs = await this.processedModel.countDocuments({});
    const docs = await this.processedModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(scanLimit)
      .select([
        '_id',
        'sessionId',
        'orderIds',
        'amountTotalCents',
        'perStoreBreakdown',
      ])
      .lean()
      .exec();

    let successRuns = 0;
    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];

    for (const doc of docs) {
      const docId = String((doc as { _id?: unknown })._id ?? '');
      const sessionId = String(
        (doc as { sessionId?: unknown }).sessionId ?? '',
      ).trim();
      const amountTotalCents = Number(
        (doc as { amountTotalCents?: unknown }).amountTotalCents ?? 0,
      );
      const orderIds = Array.isArray((doc as { orderIds?: unknown }).orderIds)
        ? (doc as { orderIds: unknown[] }).orderIds.map((x) => String(x))
        : [];
      const rows = Array.isArray(
        (doc as { perStoreBreakdown?: unknown }).perStoreBreakdown,
      )
        ? (doc as { perStoreBreakdown: Array<Record<string, unknown>> })
            .perStoreBreakdown ?? []
        : [];
      const issues: string[] = [];

      if (!sessionId.startsWith('pi_') && !sessionId.startsWith('cs_')) {
        issues.push('invalid_session_id_format');
      }
      if (!orderIds.length) {
        issues.push('missing_order_ids');
      }
      if (new Set(orderIds).size !== orderIds.length) {
        issues.push('duplicate_order_ids');
      }
      if (amountTotalCents <= 0) {
        issues.push('non_positive_amount_total_cents');
      }
      if (!rows.length) {
        issues.push('missing_per_store_breakdown');
      } else {
        for (const [idx, row] of rows.entries()) {
          const storeId = String(row.storeId ?? '').trim();
          const goodsCents = Number(row.goodsCents ?? 0);
          const shipCents = Number(row.shipCents ?? 0);
          if (!storeId) {
            issues.push(`breakdown_missing_store_id:${idx}`);
            break;
          }
          if (!Number.isFinite(goodsCents) || goodsCents < 0) {
            issues.push(`breakdown_invalid_goods:${idx}`);
            break;
          }
          if (!Number.isFinite(shipCents) || shipCents < 0) {
            issues.push(`breakdown_invalid_ship:${idx}`);
            break;
          }
        }
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: docId || sessionId || 'unknown',
          issues,
        });
      }
    }

    const totalRuns = docs.length;
    const score = totalRuns
      ? Number(((successRuns / totalRuns) * 100).toFixed(2))
      : 100;
    const confidence = Number(
      Math.min(99, 65 + Math.min(totalRuns, 3000) / 60).toFixed(2),
    );
    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary:
        totalDocs > scanLimit
          ? `${successRuns}/${totalRuns} documents valides (scan limité aux ${scanLimit} plus récents sur ${totalDocs}).`
          : `${successRuns}/${totalRuns} documents valides.`,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runStuckCreatedOrdersIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'stuck-created-orders-test';
    const label = 'Stuck Created Orders Test';
    const maxAgeHours = this.getCreatedOrderMaxAgeHours();
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000);

    const totalRuns = await this.orderModel.countDocuments({
      status: OrderStatusEnum.CREATED,
    });
    const stuckCount = await this.orderModel.countDocuments({
      status: OrderStatusEnum.CREATED,
      createdAt: { $lt: cutoff },
    });
    const sampleDocs = await this.orderModel
      .find({
        status: OrderStatusEnum.CREATED,
        createdAt: { $lt: cutoff },
      })
      .sort({ createdAt: 1 })
      .limit(25)
      .select(['_id', 'createdAt'])
      .lean()
      .exec();

    const successRuns = Math.max(0, totalRuns - stuckCount);
    const sampleFailures: IntegrityTestRunResult['sampleFailures'] =
      sampleDocs.map((doc) => ({
        orderId: String(doc._id),
        issues: [
          `created_order_stuck_over_${maxAgeHours}h`,
          `created_at:${new Date(
            String((doc as { createdAt?: unknown }).createdAt ?? ''),
          ).toISOString()}`,
        ],
      }));
    const score = totalRuns
      ? Number(((successRuns / totalRuns) * 100).toFixed(2))
      : 100;
    const confidence = totalRuns > 0 ? 95 : 80;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary: `${stuckCount} commande(s) created bloquée(s) au-delà de ${maxAgeHours}h.`,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runOperationalGuardsIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'operational-guards-test';
    const label = 'Operational Guards Test';

    const checks: Array<{
      id: string;
      ok: boolean;
      issue: string;
    }> = [];

    const jwtSecret = String(
      this.config.get<string>('JWT_SECRET') ?? '',
    ).trim();
    checks.push({
      id: 'JWT_SECRET',
      ok: jwtSecret.length >= 16,
      issue: 'jwt_secret_too_short_or_missing',
    });

    const stripeSecretKey = String(
      this.config.get<string>('STRIPE_SECRET_KEY') ?? '',
    ).trim();
    checks.push({
      id: 'STRIPE_SECRET_KEY',
      ok: stripeSecretKey.startsWith('sk_'),
      issue: 'stripe_secret_key_missing_or_invalid',
    });

    const stripeWebhookSecret = String(
      this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '',
    ).trim();
    checks.push({
      id: 'STRIPE_WEBHOOK_SECRET',
      ok: stripeWebhookSecret.startsWith('whsec_'),
      issue: 'stripe_webhook_secret_missing_or_invalid',
    });

    const recaptchaEnforce = String(
      this.config.get<string>('RECAPTCHA_ENTERPRISE_ENFORCE') ?? '',
    )
      .trim()
      .toLowerCase();
    const recaptchaSiteKey = String(
      this.config.get<string>('RECAPTCHA_ENTERPRISE_SITE_KEY') ?? '',
    ).trim();
    checks.push({
      id: 'RECAPTCHA_ENTERPRISE',
      ok: recaptchaEnforce !== 'true' || recaptchaSiteKey.length > 10,
      issue: 'recaptcha_enforce_without_site_key',
    });

    const totalRuns = checks.length;
    const successRuns = checks.filter((c) => c.ok).length;
    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = checks
      .filter((c) => !c.ok)
      .map((c) => ({
        orderId: c.id,
        issues: [c.issue],
      }));
    const score = Number(((successRuns / totalRuns) * 100).toFixed(2));
    const confidence = 98;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary: `${successRuns}/${totalRuns} garde-fous opérationnels conformes.`,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runSubscriptionRestrictionsIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'subscription-restrictions-test';
    const label = 'Subscription Restrictions Test';
    const scanLimit = this.getIntegrityScanLimit();

    const stores = await this.storeModel
      .find({})
      .sort({ createdAt: 1, _id: 1 })
      .limit(scanLimit)
      .select(['_id', 'owner'])
      .lean()
      .exec();

    if (!stores.length) {
      return this.decorateIntegrityResult({
        key,
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary:
          'Aucune boutique à auditer pour les restrictions d’abonnement.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      });
    }

    const ownerStoreCounts = new Map<string, number>();
    for (const store of stores as Array<Record<string, unknown>>) {
      const ownerId = String(store.owner ?? '').trim();
      if (!ownerId) continue;
      ownerStoreCounts.set(ownerId, (ownerStoreCounts.get(ownerId) ?? 0) + 1);
    }

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let ownerChecksTotal = 0;
    let ownerChecksSuccess = 0;
    for (const [ownerId, storeCount] of ownerStoreCounts.entries()) {
      ownerChecksTotal += 1;
      const limit =
        await this.subscriptionsService.resolveStoreCreationLimitForOwner(
          ownerId,
        );
      if (limit == null || storeCount <= limit) {
        ownerChecksSuccess += 1;
        continue;
      }
      if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `owner:${ownerId}`,
          issues: [
            `owner_store_limit_exceeded:${storeCount}>${limit}`,
            'store_quota_violation',
          ],
        });
      }
    }

    let storeChecksSuccess = 0;
    for (const store of stores as Array<Record<string, unknown>>) {
      const storeId = String(store._id ?? '').trim();
      const issues: string[] = [];

      const catalogLimit =
        await this.subscriptionsService.resolveCatalogItemLimitForStore(
          storeId,
        );
      if (catalogLimit != null) {
        const [foods, drinks] = await Promise.all([
          this.productModel.countDocuments({ store: store._id }).exec(),
          this.drinkModel.countDocuments({ store: store._id }).exec(),
        ]);
        const totalItems = Number(foods) + Number(drinks);
        if (totalItems > catalogLimit) {
          issues.push(
            `store_catalog_limit_exceeded:${totalItems}>${catalogLimit}`,
          );
          issues.push('catalog_quota_violation');
        }
      }

      if (!issues.length) {
        storeChecksSuccess += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `store:${storeId}`,
          issues,
        });
      }
    }

    const totalRuns = ownerChecksTotal + stores.length;
    const successRuns = ownerChecksSuccess + storeChecksSuccess;
    const score =
      totalRuns > 0
        ? Number(((successRuns / totalRuns) * 100).toFixed(2))
        : 100;
    const confidence = Number(
      Math.min(99, 70 + Math.min(totalRuns, 5000) / 80).toFixed(2),
    );
    const summary =
      stores.length === scanLimit
        ? `${successRuns}/${totalRuns} checks valides (scan limité à ${scanLimit} boutiques).`
        : `${successRuns}/${totalRuns} checks valides (quotas boutiques + catalogue).`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runSubscriptionDowngradeImpactIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'subscription-downgrade-impact-test';
    const label = 'Subscription Downgrade Impact Test';
    const scanLimit = this.getIntegrityScanLimit();

    const stores = await this.storeModel
      .find({})
      .sort({ createdAt: 1, _id: 1 })
      .limit(scanLimit)
      .select(['_id', 'owner'])
      .lean()
      .exec();

    const ownerIds = [
      ...new Set(
        (stores as Array<Record<string, unknown>>)
          .map((s) => String(s.owner ?? '').trim())
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];

    if (!ownerIds.length) {
      return this.decorateIntegrityResult({
        key,
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary:
          'Aucun vendeur propriétaire de boutique à auditer pour le downgrade impact.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      });
    }

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    let impactedOwners = 0;
    let impactedStores = 0;
    let impactedItems = 0;

    for (const ownerId of ownerIds) {
      const issues: string[] = [];
      const impact =
        await this.subscriptionsService.resolvePlanDowngradeImpactForOwner(
          ownerId,
        );
      const hiddenStores = Math.max(
        0,
        Number((impact as { hiddenStores?: unknown }).hiddenStores ?? 0),
      );
      const hiddenCatalogItems = Math.max(
        0,
        Number(
          (impact as { hiddenCatalogItems?: unknown }).hiddenCatalogItems ?? 0,
        ),
      );

      if (hiddenStores > 0) {
        issues.push(`downgrade_hidden_stores:${hiddenStores}`);
      }
      if (hiddenCatalogItems > 0) {
        issues.push(`downgrade_hidden_catalog_items:${hiddenCatalogItems}`);
      }

      if (!issues.length) {
        successRuns += 1;
      } else {
        impactedOwners += 1;
        impactedStores += hiddenStores;
        impactedItems += hiddenCatalogItems;
        if (sampleFailures.length < 25) {
          sampleFailures.push({
            orderId: `owner:${ownerId}`,
            issues,
          });
        }
      }
    }

    const totalRuns = ownerIds.length;
    const score =
      totalRuns > 0
        ? Number(((successRuns / totalRuns) * 100).toFixed(2))
        : 100;
    const confidence = Number(
      Math.min(99, 70 + Math.min(totalRuns, 5000) / 80).toFixed(2),
    );
    const summary =
      impactedOwners === 0
        ? `Aucun impact downgrade détecté sur ${totalRuns} vendeur(s).`
        : `${impactedOwners}/${totalRuns} vendeur(s) impacté(s) — ${impactedStores} boutique(s) et ${impactedItems} article(s) potentiellement masqués.`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async loadNotificationChannelAvailability(): Promise<AdNotificationChannelAvailability> {
    const doc = await this.adNotificationPricingModel
      .findOne({ key: 'default' })
      .select('availableChannels')
      .lean()
      .exec();
    return parseAvailableChannelsFromDoc(
      doc as Record<string, unknown> | null | undefined,
    );
  }

  private collectNotificationAddonIssues(
    addonRaw: unknown,
    availability: AdNotificationChannelAvailability,
  ): string[] {
    const addon = notificationAddonFromDoc(
      addonRaw as Record<string, unknown> | null | undefined,
    );
    if (!addon.enabled) return [];
    const issues: string[] = [];
    const ch = addon.channels;
    if (!Object.values(ch).some(Boolean)) {
      issues.push('notification_enabled_without_channel');
    }
    if (ch.email && !availability.email) {
      issues.push('notification_channel_email_unavailable');
    }
    if (ch.push && !availability.push) {
      issues.push('notification_channel_push_unavailable');
    }
    if (ch.inApp && !availability.inApp) {
      issues.push('notification_channel_inapp_unavailable');
    }
    if (ch.sms && !availability.sms) {
      issues.push('notification_channel_sms_unavailable');
    }
    if (ch.whatsapp && !availability.whatsapp) {
      issues.push('notification_channel_whatsapp_unavailable');
    }
    return issues;
  }

  private collectAudienceTotalIssues(doc: Record<string, unknown>): string[] {
    const raw = doc.audienceTotal ?? doc.audience_total;
    if (raw == null || raw === '') return [];
    const normalized = audienceTotalFromDoc(doc);
    if (normalized == null) return ['invalid_audience_total'];
    return [];
  }

  private async isFirebaseMessagingReady(): Promise<boolean> {
    if (!String(this.firebaseApp?.options?.projectId ?? '').trim()) {
      return false;
    }
    try {
      getMessaging(this.firebaseApp);
      return true;
    } catch {
      return false;
    }
  }

  private adNotificationProcessEnv(): NodeJS.ProcessEnv {
    const keys = [
      'AD_SMTP_USER',
      'AD_SMTP_APP_PASSWORD',
      'AD_SMTP_PASS',
      'REDIS_URL',
      'BULLMQ_REDIS_URL',
      'BULLMQ_REDIS_HOST',
      'BULLMQ_REDIS_PASSWORD',
      'REDIS_CONNECTION_URL',
      'AD_NOTIFICATION_SMS_ENABLED',
      'AD_NOTIFICATION_WHATSAPP_ENABLED',
      'BIRD_ACCESS_KEY',
      'BIRD_WORKSPACE_ID',
      'BIRD_SMS_CHANNEL_ID',
      'BIRD_WHATSAPP_CHANNEL_ID',
      'DISABLE_AD_NOTIFICATION_DISPATCH_CRON',
    ] as const;
    const merged = { ...process.env } as NodeJS.ProcessEnv;
    for (const key of keys) {
      const value = this.config.get<string>(key);
      if (value != null && String(value).trim() !== '') {
        merged[key] = String(value).trim();
      }
    }
    return merged;
  }

  private async isWsHealthReachable(): Promise<boolean> {
    const base =
      String(
        this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL') ?? '',
      ).trim() || 'http://localhost:8000';
    const url = `${base.replace(/\/$/, '')}/api/health`;
    try {
      const res = await this.fetchWithTimeout(url, 4000);
      return res.ok;
    } catch {
      return false;
    }
  }

  private async runAdsIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'ads-integrity-test';
    const label = 'Ads Integrity Test';
    const scanLimit = this.getIntegrityScanLimit();
    const nowMs = Date.now();
    const channelAvailability = await this.loadNotificationChannelAvailability();

    const ads = await this.adModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(scanLimit)
      .select([
        '_id',
        'title',
        'subtitle',
        'actionText',
        'isActive',
        'validFrom',
        'validUntil',
        'actionType',
        'actionTarget',
        'store',
        'product',
        'notificationAddon',
        'audienceTotal',
      ])
      .lean()
      .exec();

    const campaigns = await this.adCampaignModel
      .find({ archivedAt: { $exists: false } })
      .sort({ createdAt: -1 })
      .limit(scanLimit)
      .select([
        '_id',
        'title',
        'subtitle',
        'description',
        'isActive',
        'startsAt',
        'endsAt',
        'actionType',
        'actionTarget',
        'actionText',
        'store',
        'items',
        'notificationAddon',
        'audienceTotal',
      ])
      .lean()
      .exec();

    if (!ads.length && !campaigns.length) {
      return this.decorateIntegrityResult({
        key,
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary: 'Aucune bannière ni campagne à auditer.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      });
    }

    const storeIds = [
      ...new Set(
        (ads as Array<Record<string, unknown>>)
          .map((a) => String(a.store ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const productIds = [
      ...new Set(
        (ads as Array<Record<string, unknown>>)
          .map((a) => String(a.product ?? '').trim())
          .filter(Boolean),
      ),
    ];

    const [stores, products] = await Promise.all([
      storeIds.length
        ? this.storeModel
            .find({ _id: { $in: storeIds } })
            .select('_id')
            .lean()
            .exec()
        : Promise.resolve([]),
      productIds.length
        ? this.productModel
            .find({ _id: { $in: productIds } })
            .select('_id store')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);
    const knownStores = new Set(
      (stores as Array<Record<string, unknown>>).map((s) =>
        String(s._id ?? '').trim(),
      ),
    );
    const productStoreById = new Map(
      (products as Array<Record<string, unknown>>).map((p) => [
        String(p._id ?? '').trim(),
        String(p.store ?? '').trim(),
      ]),
    );

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    const actionTypes = new Set<string>(Object.values(StoreAdActionTypeEnum));
    const linkActionTypes = new Set<string>([
      StoreAdActionTypeEnum.WHATSAPP,
      StoreAdActionTypeEnum.CALL,
      StoreAdActionTypeEnum.EMAIL,
      StoreAdActionTypeEnum.WEBSITE,
    ]);

    for (const ad of ads as Array<Record<string, unknown>>) {
      const adId = String(ad._id ?? '').trim();
      const issues: string[] = [];
      const title = String(ad.title ?? '').trim();
      const subtitle = String(ad.subtitle ?? '').trim();
      const actionText = String(ad.actionText ?? '').trim();
      const actionType = String(ad.actionType ?? '').trim();
      const actionTarget = String(ad.actionTarget ?? '').trim();
      const storeId = String(ad.store ?? '').trim();
      const productId = String(ad.product ?? '').trim();
      const isActive = ad.isActive === true;

      const validFrom = ad.validFrom ? new Date(String(ad.validFrom)) : null;
      const validUntil = ad.validUntil ? new Date(String(ad.validUntil)) : null;

      if (!title) issues.push('missing_ad_title');
      if (!subtitle) issues.push('missing_ad_subtitle');
      if (!actionText) issues.push('missing_ad_action_text');
      if (!actionType || !actionTypes.has(actionType)) {
        issues.push('invalid_ad_action_type');
      }
      if (storeId && !knownStores.has(storeId)) {
        issues.push('ad_store_not_found');
      }
      if (validFrom && Number.isNaN(validFrom.getTime())) {
        issues.push('invalid_valid_from');
      }
      if (validUntil && Number.isNaN(validUntil.getTime())) {
        issues.push('invalid_valid_until');
      }
      if (
        validFrom &&
        validUntil &&
        !Number.isNaN(validFrom.getTime()) &&
        !Number.isNaN(validUntil.getTime()) &&
        validUntil.getTime() <= validFrom.getTime()
      ) {
        issues.push('invalid_date_range');
      }

      if (actionType === StoreAdActionTypeEnum.PRODUCT) {
        if (!productId) {
          issues.push('missing_product_for_product_action');
        } else if (!productStoreById.has(productId)) {
          issues.push('ad_product_not_found');
        } else if (storeId && productStoreById.get(productId) !== storeId) {
          issues.push('ad_product_store_mismatch');
        }
      } else if (linkActionTypes.has(actionType)) {
        if (!actionTarget) {
          issues.push('missing_action_target');
        } else if (actionType === StoreAdActionTypeEnum.EMAIL) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actionTarget)) {
            issues.push('invalid_action_target_email');
          }
        } else if (actionType === StoreAdActionTypeEnum.WEBSITE) {
          try {
            const u = new URL(
              /^[a-z]+:/i.test(actionTarget)
                ? actionTarget
                : `https://${actionTarget}`,
            );
            if (u.protocol !== 'http:' && u.protocol !== 'https:') {
              issues.push('invalid_action_target_url');
            }
          } catch {
            issues.push('invalid_action_target_url');
          }
        } else {
          const digits = actionTarget.replace(/\D/g, '');
          if (digits.length < 6) {
            issues.push('invalid_action_target_phone');
          }
        }
      }

      if (isActive) {
        if (
          validFrom &&
          !Number.isNaN(validFrom.getTime()) &&
          validFrom.getTime() > nowMs
        ) {
          issues.push('active_ad_not_started');
        }
        if (
          validUntil &&
          !Number.isNaN(validUntil.getTime()) &&
          validUntil.getTime() < nowMs
        ) {
          issues.push('active_ad_expired');
        }
      }

      issues.push(
        ...this.collectNotificationAddonIssues(
          ad.notificationAddon,
          channelAvailability,
        ),
      );
      issues.push(...this.collectAudienceTotalIssues(ad));

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `ad:${adId || 'unknown'}`,
          issues,
        });
      }
    }

    const campaignStoreIds = [
      ...new Set(
        (campaigns as Array<Record<string, unknown>>)
          .map((c) => String(c.store ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const campaignProductIds = new Set<string>();
    const campaignDrinkIds = new Set<string>();
    for (const c of campaigns as Array<Record<string, unknown>>) {
      const items = Array.isArray(c.items) ? c.items : [];
      for (const item of items as Array<Record<string, unknown>>) {
        const itemType = String(item.itemType ?? '')
          .trim()
          .toUpperCase();
        const p = String(item.product ?? '').trim();
        const d = String(item.drink ?? '').trim();
        if (itemType === AdCampaignItemTypeEnum.PRODUCT && p) {
          campaignProductIds.add(p);
        }
        if (itemType === AdCampaignItemTypeEnum.DRINK && d) {
          campaignDrinkIds.add(d);
        }
      }
    }

    const [campaignStores, campaignProducts, campaignDrinks] = await Promise.all([
      campaignStoreIds.length
        ? this.storeModel
            .find({ _id: { $in: campaignStoreIds } })
            .select('_id')
            .lean()
            .exec()
        : Promise.resolve([]),
      campaignProductIds.size
        ? this.productModel
            .find({ _id: { $in: [...campaignProductIds] } })
            .select('_id store')
            .lean()
            .exec()
        : Promise.resolve([]),
      campaignDrinkIds.size
        ? this.drinkModel
            .find({ _id: { $in: [...campaignDrinkIds] } })
            .select('_id store')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);
    const knownCampaignStores = new Set(
      (campaignStores as Array<Record<string, unknown>>).map((s) =>
        String(s._id ?? '').trim(),
      ),
    );
    const campaignProductStoreById = new Map(
      (campaignProducts as Array<Record<string, unknown>>).map((p) => [
        String(p._id ?? '').trim(),
        String(p.store ?? '').trim(),
      ]),
    );
    const knownCampaignDrinks = new Set(
      (campaignDrinks as Array<Record<string, unknown>>).map((d) =>
        String(d._id ?? '').trim(),
      ),
    );

    for (const campaign of campaigns as Array<Record<string, unknown>>) {
      const campaignId = String(campaign._id ?? '').trim();
      const issues: string[] = [];
      const title = String(campaign.title ?? '').trim();
      const storeId = String(campaign.store ?? '').trim();
      const isActive = campaign.isActive === true;
      const startsAt = campaign.startsAt
        ? new Date(String(campaign.startsAt))
        : null;
      const endsAt = campaign.endsAt ? new Date(String(campaign.endsAt)) : null;
      const items = Array.isArray(campaign.items) ? campaign.items : [];

      if (!title) issues.push('missing_campaign_title');
      if (!storeId || !knownCampaignStores.has(storeId)) {
        issues.push('campaign_store_not_found');
      }
      if (!startsAt || Number.isNaN(startsAt.getTime())) {
        issues.push('invalid_campaign_starts_at');
      }
      if (!endsAt || Number.isNaN(endsAt.getTime())) {
        issues.push('invalid_campaign_ends_at');
      }
      if (
        startsAt &&
        endsAt &&
        !Number.isNaN(startsAt.getTime()) &&
        !Number.isNaN(endsAt.getTime()) &&
        endsAt.getTime() <= startsAt.getTime()
      ) {
        issues.push('invalid_campaign_date_range');
      }
      if (isActive && items.length === 0) {
        issues.push('active_campaign_without_items');
      }
      if (isActive && startsAt && endsAt) {
        if (startsAt.getTime() > nowMs) {
          issues.push('active_campaign_not_started');
        }
        if (endsAt.getTime() < nowMs) {
          issues.push('active_campaign_expired');
        }
      }

      for (const item of items as Array<Record<string, unknown>>) {
        const itemType = String(item.itemType ?? '')
          .trim()
          .toUpperCase();
        const productId = String(item.product ?? '').trim();
        const drinkId = String(item.drink ?? '').trim();
        if (itemType === AdCampaignItemTypeEnum.PRODUCT) {
          if (!productId) {
            issues.push('campaign_item_missing_product');
          } else if (!campaignProductStoreById.has(productId)) {
            issues.push('campaign_item_product_not_found');
          } else if (
            storeId &&
            campaignProductStoreById.get(productId) !== storeId
          ) {
            issues.push('campaign_item_product_store_mismatch');
          }
        } else if (itemType === AdCampaignItemTypeEnum.DRINK) {
          if (!drinkId) {
            issues.push('campaign_item_missing_drink');
          } else if (!knownCampaignDrinks.has(drinkId)) {
            issues.push('campaign_item_drink_not_found');
          }
        } else {
          issues.push('invalid_campaign_item_type');
        }
      }

      issues.push(
        ...this.collectNotificationAddonIssues(
          campaign.notificationAddon,
          channelAvailability,
        ),
      );
      issues.push(...this.collectAudienceTotalIssues(campaign));

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `campaign:${campaignId || 'unknown'}`,
          issues,
        });
      }
    }

    const [orphanAdEvents, orphanCampaignEvents] = await Promise.all([
      this.adNotificationEventModel
        .aggregate<{ n: number }>([
          { $match: { ad: { $exists: true, $ne: null } } },
          {
            $lookup: {
              from: 'ads',
              localField: 'ad',
              foreignField: '_id',
              as: 'ref',
            },
          },
          { $match: { ref: { $size: 0 } } },
          { $count: 'n' },
        ])
        .exec(),
      this.adNotificationEventModel
        .aggregate<{ n: number }>([
          { $match: { campaign: { $exists: true, $ne: null } } },
          {
            $lookup: {
              from: 'ad_campaigns',
              localField: 'campaign',
              foreignField: '_id',
              as: 'ref',
            },
          },
          { $match: { ref: { $size: 0 } } },
          { $count: 'n' },
        ])
        .exec(),
    ]);
    const orphanAdCount = Number(orphanAdEvents[0]?.n ?? 0);
    const orphanCampaignCount = Number(orphanCampaignEvents[0]?.n ?? 0);
    if (orphanAdCount === 0) successRuns += 1;
    else if (sampleFailures.length < 25) {
      sampleFailures.push({
        orderId: 'notification-events:ads',
        issues: [`orphan_ad_notification_events:${orphanAdCount}`],
      });
    }
    if (orphanCampaignCount === 0) successRuns += 1;
    else if (sampleFailures.length < 25) {
      sampleFailures.push({
        orderId: 'notification-events:campaigns',
        issues: [`orphan_campaign_notification_events:${orphanCampaignCount}`],
      });
    }

    const bannerRuns = ads.length;
    const campaignRuns = campaigns.length;
    const totalRuns = bannerRuns + campaignRuns + 2;
    const score =
      totalRuns > 0
        ? Number(((successRuns / totalRuns) * 100).toFixed(2))
        : 100;
    const confidence = Number(
      Math.min(99, 65 + Math.min(totalRuns, 3000) / 60).toFixed(2),
    );
    const summary =
      bannerRuns === scanLimit || campaignRuns === scanLimit
        ? `${successRuns}/${totalRuns} entités valides (scan limité: ${bannerRuns} bannières, ${campaignRuns} campagnes).`
        : `${successRuns}/${totalRuns} entités valides (${bannerRuns} bannières, ${campaignRuns} campagnes, contrôle événements notifications).`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runCouponCodesIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'coupon-codes-integrity-test';
    const label = 'Coupon Codes Integrity Test';
    const scanLimit = this.getIntegrityScanLimit();
    const nowMs = Date.now();

    const coupons = await this.couponModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(scanLimit)
      .select([
        '_id',
        'code',
        'store',
        'discountType',
        'value',
        'validFrom',
        'validUntil',
        'enabled',
        'usedCount',
        'maxUses',
      ])
      .lean()
      .exec();

    if (!coupons.length) {
      return this.decorateIntegrityResult({
        key,
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary: 'Aucun code promo à auditer.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      });
    }

    const storeIds = [
      ...new Set(
        (coupons as Array<Record<string, unknown>>)
          .map((c) => String(c.store ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const stores = storeIds.length
      ? await this.storeModel
          .find({ _id: { $in: storeIds } })
          .select('_id')
          .lean()
          .exec()
      : [];
    const knownStores = new Set(
      (stores as Array<Record<string, unknown>>).map((s) =>
        String(s._id ?? '').trim(),
      ),
    );

    const duplicateByStoreCode = new Set<string>();
    const seenByStoreCode = new Set<string>();
    for (const coupon of coupons as Array<Record<string, unknown>>) {
      const code = String(coupon.code ?? '')
        .trim()
        .toUpperCase();
      const storeId = String(coupon.store ?? '').trim();
      if (!code || !storeId) continue;
      const compound = `${storeId}::${code}`;
      if (seenByStoreCode.has(compound)) {
        duplicateByStoreCode.add(compound);
      } else {
        seenByStoreCode.add(compound);
      }
    }

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    const validTypes = new Set<string>(
      Object.values(StoreCouponDiscountTypeEnum),
    );
    const codePattern = /^[A-Z0-9_-]+$/;

    for (const coupon of coupons as Array<Record<string, unknown>>) {
      const couponId = String(coupon._id ?? '').trim();
      const storeId = String(coupon.store ?? '').trim();
      const code = String(coupon.code ?? '')
        .trim()
        .toUpperCase();
      const discountType = String(coupon.discountType ?? '').trim();
      const value = Number(coupon.value ?? 0);
      const usedCount = Number(coupon.usedCount ?? 0);
      const maxUsesRaw = coupon.maxUses;
      const enabled = coupon.enabled === true;
      const issues: string[] = [];

      const validFrom = coupon.validFrom
        ? new Date(String(coupon.validFrom))
        : null;
      const validUntil = coupon.validUntil
        ? new Date(String(coupon.validUntil))
        : null;

      if (!storeId || !knownStores.has(storeId)) {
        issues.push('coupon_store_not_found');
      }
      if (!code) {
        issues.push('missing_coupon_code');
      } else if (!codePattern.test(code)) {
        issues.push('coupon_code_invalid_chars');
      }
      if (!discountType || !validTypes.has(discountType)) {
        issues.push('invalid_coupon_discount_type');
      }
      if (discountType === StoreCouponDiscountTypeEnum.FIXED) {
        if (!Number.isFinite(value) || value < 0.01 || value > 999_999) {
          issues.push('invalid_fixed_discount');
        }
      } else if (discountType === StoreCouponDiscountTypeEnum.PERCENTAGE) {
        if (!Number.isFinite(value) || value < 1 || value > 100) {
          issues.push('invalid_percentage_discount');
        }
      }

      if (!(validFrom instanceof Date) || Number.isNaN(validFrom?.getTime())) {
        issues.push('invalid_valid_from');
      }
      if (
        !(validUntil instanceof Date) ||
        Number.isNaN(validUntil?.getTime())
      ) {
        issues.push('invalid_valid_until');
      }
      if (
        validFrom &&
        validUntil &&
        !Number.isNaN(validFrom.getTime()) &&
        !Number.isNaN(validUntil.getTime()) &&
        validUntil.getTime() <= validFrom.getTime()
      ) {
        issues.push('invalid_date_range');
      }

      if (!Number.isFinite(usedCount) || usedCount < 0) {
        issues.push('invalid_used_count');
      }
      if (maxUsesRaw != null) {
        const maxUses = Number(maxUsesRaw);
        if (!Number.isFinite(maxUses) || maxUses < 1) {
          issues.push('invalid_max_uses');
        } else if (Number.isFinite(usedCount) && usedCount > maxUses) {
          issues.push('used_count_exceeds_max_uses');
        }
      }

      if (enabled) {
        if (
          validFrom &&
          !Number.isNaN(validFrom.getTime()) &&
          validFrom.getTime() > nowMs
        ) {
          issues.push('enabled_coupon_not_started');
        }
        if (
          validUntil &&
          !Number.isNaN(validUntil.getTime()) &&
          validUntil.getTime() < nowMs
        ) {
          issues.push('enabled_coupon_expired');
        }
      }

      if (storeId && code && duplicateByStoreCode.has(`${storeId}::${code}`)) {
        issues.push('duplicate_coupon_code_in_store');
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `coupon:${couponId || 'unknown'}`,
          issues,
        });
      }
    }

    const totalRuns = coupons.length;
    const score = Number(((successRuns / totalRuns) * 100).toFixed(2));
    const confidence = Number(
      Math.min(99, 65 + Math.min(totalRuns, 3000) / 60).toFixed(2),
    );
    const summary =
      totalRuns === scanLimit
        ? `${successRuns}/${totalRuns} coupons valides (scan limité à ${scanLimit}).`
        : `${successRuns}/${totalRuns} coupons valides.`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private isValidObjectIdString(raw: unknown): boolean {
    const id = String(raw ?? '').trim();
    if (!id) return false;
    if (!Types.ObjectId.isValid(id)) return false;
    return String(new Types.ObjectId(id)) === id;
  }

  private async runCartFeaturesIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'cart-features-integrity-test';
    const label = 'Cart Features Integrity Test';
    const scanLimit = this.getIntegrityScanLimit();

    const cartItems = await this.cartItemModel
      .find({})
      .sort({ updatedAt: -1 })
      .limit(scanLimit)
      .select([
        '_id',
        'store',
        'user',
        'type',
        'entityId',
        'productId',
        'quantity',
        'price',
        'customizationKey',
      ])
      .lean()
      .exec();

    if (!cartItems.length) {
      return this.decorateIntegrityResult({
        key,
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary: 'Aucune ligne panier à auditer.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      });
    }

    const storeIds = new Set<string>();
    const userIds = new Set<string>();
    const productIds = new Set<string>();
    const drinkIds = new Set<string>();
    const offerIds = new Set<string>();

    for (const row of cartItems as Array<Record<string, unknown>>) {
      const storeId = String(row.store ?? '').trim();
      const userId = String(row.user ?? '').trim();
      const entityId = String(row.entityId ?? '').trim();
      const type = String(row.type ?? '').trim();
      if (storeId) storeIds.add(storeId);
      if (userId) userIds.add(userId);
      if (!entityId) continue;
      if (type === CartItemTypeEnum.PRODUCT || type === CartItemTypeEnum.PRODUCT_EXTRA) {
        productIds.add(entityId);
        const productId = String(row.productId ?? '').trim();
        if (productId) productIds.add(productId);
      } else if (type === CartItemTypeEnum.DRINK) {
        drinkIds.add(entityId);
      } else if (type === CartItemTypeEnum.OFFER) {
        offerIds.add(entityId);
      }
    }

    const [stores, users, products, drinks, offers] = await Promise.all([
      storeIds.size
        ? this.storeModel
            .find({ _id: { $in: [...storeIds] } })
            .select('_id status')
            .lean()
            .exec()
        : Promise.resolve([]),
      userIds.size
        ? this.userModel
            .find({ _id: { $in: [...userIds] } })
            .select('_id')
            .lean()
            .exec()
        : Promise.resolve([]),
      productIds.size
        ? this.productModel
            .find({ _id: { $in: [...productIds] } })
            .select('_id store status extras')
            .lean()
            .exec()
        : Promise.resolve([]),
      drinkIds.size
        ? this.drinkModel
            .find({ _id: { $in: [...drinkIds] } })
            .select('_id store quantite')
            .lean()
            .exec()
        : Promise.resolve([]),
      offerIds.size
        ? this.offerModel
            .find({ _id: { $in: [...offerIds] } })
            .select('_id store status price discountPrice items')
            .lean()
            .exec()
        : Promise.resolve([]),
    ]);

    const storeById = new Map(
      (stores as Array<Record<string, unknown>>).map((s) => [
        String(s._id ?? ''),
        s,
      ]),
    );
    const knownUsers = new Set(
      (users as Array<Record<string, unknown>>).map((u) =>
        String(u._id ?? '').trim(),
      ),
    );
    const productById = new Map(
      (products as Array<Record<string, unknown>>).map((p) => [
        String(p._id ?? ''),
        p,
      ]),
    );
    const drinkById = new Map(
      (drinks as Array<Record<string, unknown>>).map((d) => [
        String(d._id ?? ''),
        d,
      ]),
    );
    const offerById = new Map(
      (offers as Array<Record<string, unknown>>).map((o) => [
        String(o._id ?? ''),
        o,
      ]),
    );

    const validTypes = new Set<string>(Object.values(CartItemTypeEnum));
    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;

    for (const row of cartItems as Array<Record<string, unknown>>) {
      const lineId = String(row._id ?? '').trim();
      const storeId = String(row.store ?? '').trim();
      const userId = String(row.user ?? '').trim();
      const type = String(row.type ?? '').trim();
      const entityId = String(row.entityId ?? '').trim();
      const productId = String(row.productId ?? '').trim();
      const quantity = Number(row.quantity ?? 0);
      const price = Number(row.price ?? 0);
      const issues: string[] = [];

      if (!type || !validTypes.has(type)) {
        issues.push('invalid_cart_item_type');
      }
      if (!this.isValidObjectIdString(entityId)) {
        issues.push('invalid_cart_entity_id');
      }
      if (!Number.isFinite(quantity) || quantity < 1) {
        issues.push('invalid_cart_quantity');
      }
      if (!Number.isFinite(price) || price < 0) {
        issues.push('invalid_cart_price');
      }
      if (!storeId || !storeById.has(storeId)) {
        issues.push('cart_store_not_found');
      }
      if (!userId || !knownUsers.has(userId)) {
        issues.push('cart_user_not_found');
      }

      if (type === CartItemTypeEnum.PRODUCT_EXTRA) {
        if (!this.isValidObjectIdString(productId)) {
          issues.push('missing_cart_product_id_for_extra');
        } else {
          const parent = productById.get(productId);
          if (!parent) {
            issues.push('cart_extra_parent_product_not_found');
          } else {
            const extras = (parent.extras as Array<Record<string, unknown>>) ?? [];
            const extraMatch = extras.some(
              (e) => String(e._id ?? e['id'] ?? '').trim() === entityId,
            );
            if (!extraMatch) {
              issues.push('cart_extra_not_in_product');
            }
            const parentStore = String(parent.store ?? '').trim();
            if (parentStore && storeId && parentStore !== storeId) {
              issues.push('cart_extra_store_mismatch');
            }
          }
        }
      } else if (type === CartItemTypeEnum.PRODUCT) {
        const product = productById.get(entityId);
        if (!product) {
          issues.push('cart_product_not_found');
        } else {
          const productStore = String(product.store ?? '').trim();
          if (productStore && storeId && productStore !== storeId) {
            issues.push('cart_product_store_mismatch');
          }
          if (String(product.status ?? '') !== ProductStatusEnum.ACTIVE) {
            issues.push('cart_product_not_active');
          }
        }
      } else if (type === CartItemTypeEnum.DRINK) {
        const drink = drinkById.get(entityId);
        if (!drink) {
          issues.push('cart_drink_not_found');
        } else {
          const drinkStore = String(drink.store ?? '').trim();
          if (drinkStore && storeId && drinkStore !== storeId) {
            issues.push('cart_drink_store_mismatch');
          }
          const stock = Number(drink.quantite ?? 0);
          if (Number.isFinite(stock) && stock <= 0) {
            issues.push('cart_drink_out_of_stock');
          }
        }
      } else if (type === CartItemTypeEnum.OFFER) {
        const offer = offerById.get(entityId);
        if (!offer) {
          issues.push('cart_offer_not_found');
        } else {
          const offerStore = String(offer.store ?? '').trim();
          if (offerStore && storeId && offerStore !== storeId) {
            issues.push('cart_offer_store_mismatch');
          }
          if (String(offer.status ?? '') !== OfferStatusEnum.ACTIVE) {
            issues.push('cart_offer_not_active');
          }
          const items = (offer.items as unknown[]) ?? [];
          if (!Array.isArray(items) || items.length < 2) {
            issues.push('cart_offer_invalid_items');
          }
        }
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `cart:${lineId || 'unknown'}`,
          issues,
        });
      }
    }

    const totalRuns = cartItems.length;
    const score = Number(((successRuns / totalRuns) * 100).toFixed(2));
    const confidence = Number(
      Math.min(99, 65 + Math.min(totalRuns, 3000) / 60).toFixed(2),
    );
    const summary =
      totalRuns === scanLimit
        ? `${successRuns}/${totalRuns} lignes panier valides (scan limité à ${scanLimit}).`
        : `${successRuns}/${totalRuns} lignes panier valides.`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runProductRecommendationsIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'product-recommendations-integrity-test';
    const label = 'Product Recommendations Integrity Test';
    const scanLimit = this.getIntegrityScanLimit();
    const nowMs = Date.now();
    const staleSnapshotMs = 72 * 60 * 60 * 1000;

    const [snapshot, digests] = await Promise.all([
      this.recommendationSnapshotModel
        .findOne({ docKey: RECOMMENDATION_GLOBAL_SNAPSHOT_KEY })
        .lean()
        .exec(),
      this.userRecommendationDigestModel
        .find({})
        .sort({ computedAt: -1 })
        .limit(Math.min(scanLimit, 500))
        .select([
          '_id',
          'user',
          'computedAt',
          'topViewedProductIds',
          'topViewedStoreIds',
          'topSearchTerms',
        ])
        .lean()
        .exec(),
    ]);

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    let totalRuns = 0;

    if (!snapshot) {
      totalRuns += 1;
      sampleFailures.push({
        orderId: 'snapshot:global',
        issues: ['missing_global_recommendation_snapshot'],
      });
    } else {
      totalRuns += 1;
      const snapIssues: string[] = [];
      const computedAt = snapshot.computedAt
        ? new Date(String(snapshot.computedAt))
        : null;
      if (!(computedAt instanceof Date) || Number.isNaN(computedAt.getTime())) {
        snapIssues.push('invalid_snapshot_computed_at');
      } else if (nowMs - computedAt.getTime() > staleSnapshotMs) {
        snapIssues.push('stale_recommendation_snapshot');
      }

      const trendProductIds = (snapshot.trendProductIds ?? []).slice(0, 40);
      const trendStoreIds = (snapshot.trendStoreIds ?? []).slice(0, 40);
      const trendDrinkIds = (snapshot.trendDrinkIds ?? []).slice(0, 40);

      for (const id of trendProductIds) {
        if (!this.isValidObjectIdString(id)) {
          snapIssues.push('invalid_trend_product_id');
          break;
        }
      }
      for (const id of trendStoreIds) {
        if (!this.isValidObjectIdString(id)) {
          snapIssues.push('invalid_trend_store_id');
          break;
        }
      }
      for (const id of trendDrinkIds) {
        if (!this.isValidObjectIdString(id)) {
          snapIssues.push('invalid_trend_drink_id');
          break;
        }
      }

      const [knownProducts, knownStores, knownDrinks] = await Promise.all([
        trendProductIds.length
          ? this.productModel
              .find({ _id: { $in: trendProductIds } })
              .select('_id status')
              .lean()
              .exec()
          : Promise.resolve([]),
        trendStoreIds.length
          ? this.storeModel
              .find({ _id: { $in: trendStoreIds } })
              .select('_id status')
              .lean()
              .exec()
          : Promise.resolve([]),
        trendDrinkIds.length
          ? this.drinkModel
              .find({ _id: { $in: trendDrinkIds } })
              .select('_id')
              .lean()
              .exec()
          : Promise.resolve([]),
      ]);

      const productIdSet = new Set(
        (knownProducts as Array<Record<string, unknown>>).map((p) =>
          String(p._id ?? ''),
        ),
      );
      const storeIdSet = new Set(
        (knownStores as Array<Record<string, unknown>>).map((s) =>
          String(s._id ?? ''),
        ),
      );
      const drinkIdSet = new Set(
        (knownDrinks as Array<Record<string, unknown>>).map((d) =>
          String(d._id ?? ''),
        ),
      );

      if (trendProductIds.some((id) => !productIdSet.has(String(id)))) {
        snapIssues.push('trend_product_not_found');
      }
      if (
        trendProductIds.some((id) => {
          const p = (knownProducts as Array<Record<string, unknown>>).find(
            (row) => String(row._id ?? '') === String(id),
          );
          return p && String(p.status ?? '') !== ProductStatusEnum.ACTIVE;
        })
      ) {
        snapIssues.push('trend_product_not_active');
      }
      if (trendStoreIds.some((id) => !storeIdSet.has(String(id)))) {
        snapIssues.push('trend_store_not_found');
      }
      if (
        trendStoreIds.some((id) => {
          const s = (knownStores as Array<Record<string, unknown>>).find(
            (row) => String(row._id ?? '') === String(id),
          );
          return s && String(s.status ?? '') !== StoreStatusEnum.ACTIVE;
        })
      ) {
        snapIssues.push('trend_store_not_active');
      }
      if (trendDrinkIds.some((id) => !drinkIdSet.has(String(id)))) {
        snapIssues.push('trend_drink_not_found');
      }

      if (!snapIssues.length) {
        successRuns += 1;
      } else {
        sampleFailures.push({ orderId: 'snapshot:global', issues: snapIssues });
      }
    }

    const digestUserIds = [
      ...new Set(
        (digests as Array<Record<string, unknown>>)
          .map((d) => String(d.user ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const knownDigestUsers = digestUserIds.length
      ? new Set(
          (
            await this.userModel
              .find({ _id: { $in: digestUserIds } })
              .select('_id')
              .lean()
              .exec()
          ).map((u) => String((u as { _id?: unknown })._id ?? '')),
        )
      : new Set<string>();

    for (const digest of digests as Array<Record<string, unknown>>) {
      totalRuns += 1;
      const digestId = String(digest._id ?? '').trim();
      const userId = String(digest.user ?? '').trim();
      const issues: string[] = [];
      const computedAt = digest.computedAt
        ? new Date(String(digest.computedAt))
        : null;

      if (!userId || !knownDigestUsers.has(userId)) {
        issues.push('digest_user_not_found');
      }
      if (!(computedAt instanceof Date) || Number.isNaN(computedAt.getTime())) {
        issues.push('invalid_digest_computed_at');
      } else if (nowMs - computedAt.getTime() > staleSnapshotMs) {
        issues.push('stale_user_digest');
      }

      for (const pid of (digest.topViewedProductIds as string[]) ?? []) {
        if (!this.isValidObjectIdString(pid)) {
          issues.push('invalid_digest_product_id');
          break;
        }
      }
      for (const sid of (digest.topViewedStoreIds as string[]) ?? []) {
        if (!this.isValidObjectIdString(sid)) {
          issues.push('invalid_digest_store_id');
          break;
        }
      }
      for (const term of (digest.topSearchTerms as string[]) ?? []) {
        const t = String(term ?? '').trim();
        if (t && t.length < 2) {
          issues.push('invalid_digest_search_term');
          break;
        }
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `digest:${digestId || userId || 'unknown'}`,
          issues,
        });
      }
    }

    const score =
      totalRuns > 0
        ? Number(((successRuns / totalRuns) * 100).toFixed(2))
        : 100;
    const confidence = Number(
      Math.min(99, 60 + Math.min(totalRuns, 500) / 10).toFixed(2),
    );
    const summary =
      totalRuns === 0
        ? 'Aucun snapshot ni digest à auditer.'
        : `${successRuns}/${totalRuns} checks recommandations OK (snapshot + digests).`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runCatalogLoadingIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'catalog-loading-integrity-test';
    const label = 'Catalog Loading Integrity Test';
    const scanLimit = this.getIntegrityScanLimit();

    const [products, drinks] = await Promise.all([
      this.productModel
        .find({ status: ProductStatusEnum.ACTIVE })
        .sort({ updatedAt: -1 })
        .limit(scanLimit)
        .select([
          '_id',
          'title',
          'bio',
          'price',
          'store',
          'category',
          'profileImage',
          'imageBase64',
          'galleryImages',
        ])
        .lean()
        .exec(),
      this.drinkModel
        .find({})
        .sort({ updatedAt: -1 })
        .limit(scanLimit)
        .select([
          '_id',
          'name',
          'priceCad',
          'quantite',
          'store',
          'imageUrl',
        ])
        .lean()
        .exec(),
    ]);

    const storeIds = [
      ...new Set([
        ...(products as Array<Record<string, unknown>>)
          .map((p) => String(p.store ?? '').trim())
          .filter(Boolean),
        ...(drinks as Array<Record<string, unknown>>)
          .map((d) => String(d.store ?? '').trim())
          .filter(Boolean),
      ]),
    ];
    const stores = storeIds.length
      ? await this.storeModel
          .find({ _id: { $in: storeIds } })
          .select('_id status name')
          .lean()
          .exec()
      : [];
    const storeById = new Map(
      (stores as Array<Record<string, unknown>>).map((s) => [
        String(s._id ?? ''),
        s,
      ]),
    );

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    let totalRuns = 0;

    const auditCatalogRow = (
      rowId: string,
      prefix: string,
      storeId: string,
      issues: string[],
    ) => {
      totalRuns += 1;
      if (!storeId || !storeById.has(storeId)) {
        issues.push('catalog_store_not_found');
      } else {
        const store = storeById.get(storeId)!;
        if (String(store.status ?? '') !== StoreStatusEnum.ACTIVE) {
          issues.push('catalog_store_not_active');
        }
      }
      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({ orderId: `${prefix}:${rowId}`, issues });
      }
    };

    for (const product of products as Array<Record<string, unknown>>) {
      const productId = String(product._id ?? '').trim();
      const storeId = String(product.store ?? '').trim();
      const title = String(product.title ?? '').trim();
      const bio = String(product.bio ?? '').trim();
      const price = Number(product.price ?? 0);
      const category = String(product.category ?? '').trim();
      const profileImage = String(product.profileImage ?? '').trim();
      const imageBase64 = String(product.imageBase64 ?? '').trim();
      const gallery = (product.galleryImages as unknown[]) ?? [];
      const issues: string[] = [];

      if (!title) issues.push('missing_product_title');
      if (!bio) issues.push('missing_product_bio');
      if (!Number.isFinite(price) || price < 0) issues.push('invalid_product_price');
      if (!this.isValidObjectIdString(category)) issues.push('missing_product_category');
      if (!profileImage && !imageBase64 && (!Array.isArray(gallery) || !gallery.length)) {
        issues.push('missing_product_image');
      }

      auditCatalogRow(productId, 'product', storeId, issues);
    }

    for (const drink of drinks as Array<Record<string, unknown>>) {
      const drinkId = String(drink._id ?? '').trim();
      const storeId = String(drink.store ?? '').trim();
      const name = String(drink.name ?? '').trim();
      const priceCad = Number(drink.priceCad ?? 0);
      const quantite = Number(drink.quantite ?? 0);
      const issues: string[] = [];

      if (!name) issues.push('missing_drink_name');
      if (!Number.isFinite(priceCad) || priceCad < 0) issues.push('invalid_drink_price');
      if (!Number.isFinite(quantite) || quantite < 0) issues.push('invalid_drink_quantity');
      if (quantite <= 0) issues.push('drink_not_visible_in_catalog');

      auditCatalogRow(drinkId, 'drink', storeId, issues);
    }

    const score =
      totalRuns > 0
        ? Number(((successRuns / totalRuns) * 100).toFixed(2))
        : 100;
    const confidence = Number(
      Math.min(99, 65 + Math.min(totalRuns, 4000) / 80).toFixed(2),
    );
    const summary =
      totalRuns === 0
        ? 'Aucun article catalogue actif à auditer.'
        : `${successRuns}/${totalRuns} articles catalogue chargeables (${products.length} produits, ${drinks.length} boissons scannés).`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runStoreDetailPageIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'store-detail-page-integrity-test';
    const label = 'Store Detail Page Integrity Test';
    const scanLimit = this.getIntegrityScanLimit();

    const stores = await this.storeModel
      .find({ status: StoreStatusEnum.ACTIVE })
      .sort({ updatedAt: -1 })
      .limit(scanLimit)
      .select([
        '_id',
        'name',
        'bio',
        'email',
        'phoneNumber',
        'currency',
        'region',
        'profileImage',
        'address',
        'acceptsOrders',
        'canCreateProducts',
      ])
      .populate({
        path: 'address',
        select: 'address city country countryCode zipCode label location',
      })
      .lean()
      .exec();

    if (!stores.length) {
      return this.decorateIntegrityResult({
        key,
        label,
        totalEvaluateTimeMs: Date.now() - startedAt,
        successRuns: 0,
        totalRuns: 0,
        score: 100,
        confidence: 100,
        summary: 'Aucune boutique active à auditer.',
        checkedAt: checkedAtIso,
        sampleFailures: [],
      });
    }

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;

    for (const store of stores as Array<Record<string, unknown>>) {
      const storeId = String(store._id ?? '').trim();
      const name = String(store.name ?? '').trim();
      const email = String(store.email ?? '').trim();
      const phoneNumber = String(store.phoneNumber ?? '').trim();
      const currency = String(store.currency ?? '').trim();
      const profileImage = String(store.profileImage ?? '').trim();
      const address = store.address as Record<string, unknown> | null | undefined;
      const issues: string[] = [];

      if (!name) issues.push('missing_store_name');
      if (!email) issues.push('missing_store_email');
      if (!phoneNumber) issues.push('missing_store_phone');
      if (!currency) issues.push('missing_store_currency');
      if (!profileImage) issues.push('missing_store_profile_image');
      if (!address || typeof address !== 'object') {
        issues.push('missing_store_address');
      } else {
        const city = String(address.city ?? '').trim();
        const country = String(address.country ?? '').trim();
        const countryCode = String(address.countryCode ?? '').trim();
        const labelAddr = String(address.label ?? address.address ?? '').trim();
        const location = address.location as Record<string, unknown> | undefined;
        const coords = location?.coordinates as unknown[] | undefined;
        if (!city && !country && !countryCode && !labelAddr) {
          issues.push('incomplete_store_address');
        }
        if (!Array.isArray(coords) || coords.length < 2) {
          issues.push('missing_store_geo_location');
        }
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `store:${storeId || 'unknown'}`,
          issues,
        });
      }
    }

    const totalRuns = stores.length;
    const score = Number(((successRuns / totalRuns) * 100).toFixed(2));
    const confidence = Number(
      Math.min(99, 70 + Math.min(totalRuns, 2000) / 40).toFixed(2),
    );
    const summary =
      totalRuns === scanLimit
        ? `${successRuns}/${totalRuns} boutiques prêtes pour menu-meta (scan limité à ${scanLimit}).`
        : `${successRuns}/${totalRuns} boutiques prêtes pour menu-meta.`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private async runPlatformReadinessIntegrityTest(): Promise<IntegrityTestRunResult> {
    const startedAt = Date.now();
    const checkedAtIso = new Date().toISOString();
    const key = 'platform-readiness-integrity-test';
    const label = 'Platform Readiness Integrity Test';
    const scanLimit = Math.min(this.getIntegrityScanLimit(), 2000);

    const [activeStores, activeOffers, activeProductsOnInactiveStore] =
      await Promise.all([
        this.storeModel
          .find({ status: StoreStatusEnum.ACTIVE })
          .sort({ updatedAt: -1 })
          .limit(scanLimit)
          .select('_id name acceptsOrders canCreateProducts')
          .lean()
          .exec(),
        this.offerModel
          .find({ status: OfferStatusEnum.ACTIVE })
          .sort({ updatedAt: -1 })
          .limit(scanLimit)
          .select(['_id', 'title', 'price', 'discountPrice', 'store', 'items'])
          .lean()
          .exec(),
        this.productModel
          .find({ status: ProductStatusEnum.ACTIVE })
          .sort({ updatedAt: -1 })
          .limit(scanLimit)
          .select('_id store')
          .lean()
          .exec(),
      ]);

    const storeIds = [
      ...new Set(
        (activeStores as Array<Record<string, unknown>>)
          .map((s) => String(s._id ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const storeStatusById = new Map(
      (activeStores as Array<Record<string, unknown>>).map((s) => [
        String(s._id ?? ''),
        String(s.status ?? StoreStatusEnum.ACTIVE),
      ]),
    );

    const [productCounts, drinkCounts] = await Promise.all([
      storeIds.length
        ? this.productModel
            .aggregate<{ _id: Types.ObjectId; n: number }>([
              {
                $match: {
                  store: { $in: storeIds.map((id) => new Types.ObjectId(id)) },
                  status: ProductStatusEnum.ACTIVE,
                },
              },
              { $group: { _id: '$store', n: { $sum: 1 } } },
            ])
            .exec()
        : Promise.resolve([]),
      storeIds.length
        ? this.drinkModel
            .aggregate<{ _id: Types.ObjectId; n: number }>([
              {
                $match: {
                  store: { $in: storeIds.map((id) => new Types.ObjectId(id)) },
                  quantite: { $gt: 0 },
                },
              },
              { $group: { _id: '$store', n: { $sum: 1 } } },
            ])
            .exec()
        : Promise.resolve([]),
    ]);

    const catalogCountByStore = new Map<string, number>();
    for (const row of productCounts) {
      catalogCountByStore.set(
        String(row._id ?? ''),
        (catalogCountByStore.get(String(row._id ?? '')) ?? 0) + Number(row.n ?? 0),
      );
    }
    for (const row of drinkCounts) {
      const id = String(row._id ?? '');
      catalogCountByStore.set(id, (catalogCountByStore.get(id) ?? 0) + Number(row.n ?? 0));
    }

    const allStoreIdsForProducts = [
      ...new Set(
        (activeProductsOnInactiveStore as Array<Record<string, unknown>>)
          .map((p) => String(p.store ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const storesForProducts = allStoreIdsForProducts.length
      ? await this.storeModel
          .find({ _id: { $in: allStoreIdsForProducts } })
          .select('_id status')
          .lean()
          .exec()
      : [];
    for (const s of storesForProducts as Array<Record<string, unknown>>) {
      storeStatusById.set(String(s._id ?? ''), String(s.status ?? ''));
    }

    const offerStoreIds = [
      ...new Set(
        (activeOffers as Array<Record<string, unknown>>)
          .map((o) => String(o.store ?? '').trim())
          .filter(Boolean),
      ),
    ];
    const offerStores = offerStoreIds.length
      ? await this.storeModel
          .find({ _id: { $in: offerStoreIds } })
          .select('_id status')
          .lean()
          .exec()
      : [];
    const offerStoreById = new Map(
      (offerStores as Array<Record<string, unknown>>).map((s) => [
        String(s._id ?? ''),
        s,
      ]),
    );

    const sampleFailures: IntegrityTestRunResult['sampleFailures'] = [];
    let successRuns = 0;
    let totalRuns = 0;

    for (const store of activeStores as Array<Record<string, unknown>>) {
      totalRuns += 1;
      const storeId = String(store._id ?? '').trim();
      const acceptsOrders = store.acceptsOrders === true;
      const canCreateProducts = store.canCreateProducts === true;
      const catalogCount = catalogCountByStore.get(storeId) ?? 0;
      const issues: string[] = [];

      if ((acceptsOrders || canCreateProducts) && catalogCount === 0) {
        issues.push('active_store_empty_catalog');
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `store-readiness:${storeId}`,
          issues,
        });
      }
    }

    for (const offer of activeOffers as Array<Record<string, unknown>>) {
      totalRuns += 1;
      const offerId = String(offer._id ?? '').trim();
      const storeId = String(offer.store ?? '').trim();
      const price = Number(offer.price ?? 0);
      const discountPrice = Number(offer.discountPrice ?? 0);
      const items = (offer.items as unknown[]) ?? [];
      const title = String(offer.title ?? '').trim();
      const issues: string[] = [];

      if (!title) issues.push('missing_offer_title');
      if (!Number.isFinite(price) || price <= 0) issues.push('invalid_offer_price');
      if (!Number.isFinite(discountPrice) || discountPrice <= 0) {
        issues.push('invalid_offer_discount_price');
      }
      if (
        Number.isFinite(price) &&
        Number.isFinite(discountPrice) &&
        discountPrice <= price
      ) {
        issues.push('offer_discount_not_below_price');
      }
      if (!Array.isArray(items) || items.length < 2) {
        issues.push('offer_insufficient_items');
      }
      const store = offerStoreById.get(storeId);
      if (!store) {
        issues.push('offer_store_not_found');
      } else if (String(store.status ?? '') !== StoreStatusEnum.ACTIVE) {
        issues.push('offer_store_not_active');
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `offer:${offerId || 'unknown'}`,
          issues,
        });
      }
    }

    for (const product of activeProductsOnInactiveStore as Array<
      Record<string, unknown>
    >) {
      totalRuns += 1;
      const productId = String(product._id ?? '').trim();
      const storeId = String(product.store ?? '').trim();
      const storeStatus = storeStatusById.get(storeId) ?? '';
      const issues: string[] = [];

      if (!storeId) {
        issues.push('product_missing_store');
      } else if (storeStatus !== StoreStatusEnum.ACTIVE) {
        issues.push('active_product_on_inactive_store');
      }

      if (!issues.length) {
        successRuns += 1;
      } else if (sampleFailures.length < 25) {
        sampleFailures.push({
          orderId: `product-readiness:${productId}`,
          issues,
        });
      }
    }

    const score =
      totalRuns > 0
        ? Number(((successRuns / totalRuns) * 100).toFixed(2))
        : 100;
    const confidence = Number(
      Math.min(99, 65 + Math.min(totalRuns, 3000) / 60).toFixed(2),
    );
    const summary = `${successRuns}/${totalRuns} checks plateforme OK (boutiques, offres, produits actifs).`;

    return this.decorateIntegrityResult({
      key,
      label,
      totalEvaluateTimeMs: Date.now() - startedAt,
      successRuns,
      totalRuns,
      score,
      confidence,
      summary,
      checkedAt: checkedAtIso,
      sampleFailures,
    });
  }

  private decorateIntegrityResult(
    base: Omit<IntegrityTestRunResult, 'severity' | 'failureReasonCounts'>,
  ): IntegrityTestRunResult {
    const severity = this.severityFromScore(base.score);
    const failureReasonCounts = this.buildFailureReasonCounts(
      base.sampleFailures,
    );
    return {
      ...base,
      severity,
      failureReasonCounts,
    };
  }

  private severityFromScore(score: number): IntegrityTestRunResult['severity'] {
    if (score < 70) return 'critical';
    if (score < 90) return 'high';
    if (score < 98) return 'medium';
    return 'low';
  }

  private buildFailureReasonCounts(
    failures: IntegrityTestRunResult['sampleFailures'],
  ): Array<{ reason: string; count: number }> {
    const map = new Map<string, number>();
    for (const f of failures) {
      for (const issue of f.issues ?? []) {
        const reason = String(issue || '')
          .trim()
          .split(':')[0];
        if (!reason) continue;
        map.set(reason, (map.get(reason) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  }

  private stripeClient(): InstanceType<typeof Stripe> | null {
    const sk = String(
      this.config.get<string>('STRIPE_SECRET_KEY') ?? '',
    ).trim();
    if (!sk.startsWith('sk_')) return null;
    return new this.stripeFactory(sk);
  }

  private normalizeHealthResult(input: {
    key: string;
    label: string;
    startedAtMs: number;
    status: SystemHealthCheckResult['status'];
    details: string;
  }): SystemHealthCheckResult {
    const elapsed = Math.max(0, Date.now() - input.startedAtMs);
    let score = 100;
    let confidence = 95;
    if (input.status === 'degraded') {
      score = 65;
      confidence = 80;
    } else if (input.status === 'down') {
      score = 20;
      confidence = 90;
    }
    return {
      key: input.key,
      label: input.label,
      totalEvaluateTimeMs: elapsed,
      status: input.status,
      score,
      confidence,
      details: input.details,
      checkedAt: new Date().toISOString(),
    };
  }

  private async runMongoHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'mongodb-status';
    const label = 'MongoDB status';
    const db = this.connection.db;
    if (!db) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: 'MongoDB indisponible (connexion non initialisée).',
      });
    }
    try {
      const pingRes = (await db.admin().ping()) as { ok?: number };
      const ok = Number(pingRes?.ok ?? 0) === 1;
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: ok ? 'healthy' : 'degraded',
        details: ok
          ? 'Ping MongoDB OK.'
          : `Ping MongoDB inattendu: ${JSON.stringify(pingRes)}`,
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `Erreur ping MongoDB: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }
  }

  private probeToHealthStatus(
    probeStatus: string,
  ): 'healthy' | 'degraded' | 'down' {
    if (probeStatus === 'healthy') return 'healthy';
    if (probeStatus === 'degraded') return 'degraded';
    if (probeStatus === 'disabled') return 'degraded';
    return 'down';
  }

  private async runRedisCacheHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'redis-cache-status';
    const label = 'Redis cache status';
    const probe = await probeCacheRedis(this.config);
    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status: this.probeToHealthStatus(probe.status),
      details: probe.details,
    });
  }

  private async runBullmqRedisHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'bullmq-redis-status';
    const label = 'Redis BullMQ status';
    const probe = await probeBullmqRedis(this.config);
    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status: this.probeToHealthStatus(probe.status),
      details: probe.details,
    });
  }

  private async runMemcachedHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'memcached-status';
    const label = 'Memcached status';
    const probe = await probeMemcached(this.config);
    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status: this.probeToHealthStatus(probe.status),
      details: probe.details,
    });
  }

  private async runWebsocketHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'websocket-service-status';
    const label = 'Websocket Service status';
    const base =
      String(
        this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL') ?? '',
      ).trim() || 'http://localhost:8000';
    const url = `${base.replace(/\/$/, '')}/api/health`;
    try {
      const res = await this.fetchWithTimeout(url, 5000);
      if (!res.ok) {
        return this.normalizeHealthResult({
          key,
          label,
          startedAtMs,
          status: 'down',
          details: `WS health HTTP ${res.status}`,
        });
      }
      const body = await res.text();
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'healthy',
        details: body.slice(0, 180) || 'WS health endpoint OK.',
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `WS health unreachable: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }
  }

  private async runGrpcWsNotifyHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'grpc-ws-notify-status';
    const label = 'gRPC WS Notify status';
    const [probe, runtime] = await Promise.all([
      probeGrpcWsNotify(this.config),
      this.ensureInfraRuntimeSettings().then((doc) =>
        this.toInfraRuntimeSettingsResponse(doc),
      ),
    ]);
    const metrics = this.grpcWsNotifyMetrics.snapshot();
    let details = probe.details;
    if (metrics.count > 0) {
      details += ` · dispatches n=${metrics.count}, p95=${metrics.p95Ms}ms, fallback=${(metrics.fallbackRate * 100).toFixed(1)}%`;
    }
    if (runtime.grpcWsNotifyEnabled) {
      details += ' · runtime grpcWsNotifyEnabled=ON';
    } else {
      details += ' · runtime grpcWsNotifyEnabled=OFF (HTTP/MQTT)';
    }
    let status = this.probeToHealthStatus(probe.status);
    if (
      runtime.grpcWsNotifyEnabled &&
      probe.status !== 'healthy' &&
      probe.status !== 'disabled'
    ) {
      status = 'down';
    } else if (
      !runtime.grpcWsNotifyEnabled &&
      probe.status === 'healthy'
    ) {
      status = 'healthy';
    } else if (
      !runtime.grpcWsNotifyEnabled &&
      probe.status === 'disabled'
    ) {
      status = 'degraded';
    }
    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details,
    });
  }

  private async runGrpcApiInternalHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'grpc-api-internal-status';
    const label = 'gRPC API internal status';
    const probe = await probeGrpcApiInternal(this.config);
    const wsGrpc = await this.fetchWsGrpcStatus();
    const wsToApiEnabled =
      wsGrpc.source === 'ws-internal'
        ? wsGrpc.wsToApiEnabled
        : grpcEnvFlag(this.config, 'GRPC_WS_TO_API_ENABLED', false);
    let details = probe.details;
    details += wsToApiEnabled
      ? ` · GRPC_WS_TO_API_ENABLED=ON (WS → ${wsGrpc.apiHost}:${wsGrpc.apiPort})`
      : ' · GRPC_WS_TO_API_ENABLED=OFF (repli HTTP WS→API)';
    if (wsGrpc.lastError && wsToApiEnabled) {
      details += ` · ${wsGrpc.lastError}`;
    }
    let status = this.probeToHealthStatus(probe.status);
    if (wsToApiEnabled && probe.status !== 'healthy' && probe.status !== 'disabled') {
      status = 'down';
    }
    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details,
    });
  }

  private async runApiFunctionHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'api-function-status';
    const label = 'API Function Status';
    const db = this.connection.db;
    if (!db) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: 'Connexion DB non initialisée.',
      });
    }
    try {
      await db.admin().ping();
      const uptimeSec = Math.floor(process.uptime());
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'healthy',
        details: `API up. Uptime=${uptimeSec}s, DB ping OK.`,
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'degraded',
        details: `API up mais DB ping KO: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }
  }

  private async runStripeHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'stripe-payment-status';
    const label = 'Stripe payment Status';
    const stripe = this.stripeClient();
    if (!stripe) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: 'STRIPE_SECRET_KEY non configurée.',
      });
    }
    try {
      const bal = await stripe.balance.retrieve();
      const cur = (bal.available?.[0]?.currency ?? '').toUpperCase();
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'healthy',
        details: `Stripe reachable. Solde disponible entrées=${
          bal.available?.length ?? 0
        }${cur ? ` (${cur})` : ''}.`,
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `Stripe error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async runStripeWebhookLastActivityHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'stripe-webhook-last-activity';
    const label = 'Webhook Stripe last activity';
    const maxAgeMin = Number(
      this.config.get<string>('STRIPE_WEBHOOK_ACTIVITY_MAX_AGE_MIN') ?? '30',
    );
    const thresholdMin =
      Number.isFinite(maxAgeMin) && maxAgeMin > 0 ? maxAgeMin : 30;

    try {
      const latest = await this.processedModel
        .findOne({})
        .sort({ createdAt: -1 })
        .select(['sessionId', 'stripeEventKind', 'createdAt'])
        .lean()
        .exec();

      if (!latest) {
        return this.normalizeHealthResult({
          key,
          label,
          startedAtMs,
          status: 'down',
          details: 'Aucune activité Stripe traitée pour le moment.',
        });
      }

      const createdAtRaw = (latest as { createdAt?: unknown }).createdAt;
      const createdAtMs =
        createdAtRaw instanceof Date
          ? createdAtRaw.getTime()
          : new Date(String(createdAtRaw ?? '')).getTime();
      if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
        return this.normalizeHealthResult({
          key,
          label,
          startedAtMs,
          status: 'degraded',
          details: 'Dernière activité Stripe trouvée mais date invalide.',
        });
      }

      const ageMin = (Date.now() - createdAtMs) / 60000;
      const eventKind = String(
        (latest as { stripeEventKind?: unknown }).stripeEventKind ?? 'unknown',
      );
      const paymentId = String(
        (latest as { sessionId?: unknown }).sessionId ?? '',
      );
      const status: SystemHealthCheckResult['status'] =
        ageMin <= thresholdMin
          ? 'healthy'
          : ageMin <= thresholdMin * 3
          ? 'degraded'
          : 'down';

      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status,
        details: `Dernière activité il y a ${ageMin.toFixed(
          1,
        )} min (threshold ${thresholdMin} min) — ${eventKind} / ${paymentId}.`,
      });
    } catch (e) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `Lecture activité Stripe impossible: ${
          e instanceof Error ? e.message : String(e)
        }`,
      });
    }
  }

  private async runStripeWebhookLatencyHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'stripe-webhook-latency';
    const label = 'Webhook Stripe latency (p95)';

    if (!this.stripeWebhookMetrics) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'degraded',
        details: 'Service métriques webhook indisponible.',
      });
    }

    const snap = this.stripeWebhookMetrics.snapshot();
    const targetP95 = this.stripeWebhookMetrics.p95TargetMs();

    if (snap.count < 1) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'degraded',
        details:
          `Aucun échantillon webhook sur cette instance (cible p95 < ${targetP95} ms).`,
      });
    }

    const status: SystemHealthCheckResult['status'] =
      snap.p95Ms <= targetP95
        ? 'healthy'
        : snap.p95Ms <= targetP95 * 2
        ? 'degraded'
        : 'down';

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details:
        `n=${snap.count} p50=${snap.p50Ms}ms p95=${snap.p95Ms}ms max=${snap.maxMs}ms ` +
        `avg=${snap.avgMs}ms cible<${targetP95}ms` +
        (snap.lastEventType
          ? ` — dernier=${snap.lastEventType} (${snap.lastMs}ms)`
          : ''),
    });
  }

  private async runMapEngineHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'map-engine-status';
    const label = 'Map Engine Status';

    const engines: Array<{
      name: string;
      configured: boolean;
      ok: boolean;
      detail: string;
    }> = [];

    const mapboxUrl = String(
      this.config.get<string>('MAP_BOX_API_URL') ?? '',
    ).trim();
    const mapboxToken = String(
      this.config.get<string>('MAPBOX_ACCESS_TOKEN') ?? '',
    ).trim();
    if (mapboxUrl && mapboxToken) {
      try {
        const url = new URL(mapboxUrl);
        url.searchParams.set('q', 'Montreal');
        url.searchParams.set('limit', '1');
        url.searchParams.set('access_token', mapboxToken);
        const res = await this.fetchWithTimeout(url.toString(), 7000);
        engines.push({
          name: 'Mapbox',
          configured: true,
          ok: res.ok,
          detail: res.ok ? 'joignable' : `HTTP ${res.status}`,
        });
      } catch (e) {
        engines.push({
          name: 'Mapbox',
          configured: true,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      engines.push({
        name: 'Mapbox',
        configured: false,
        ok: false,
        detail: 'non configuré',
      });
    }

    const googleKey = String(
      this.config.get<string>('GOOGLE_MAPS_API_KEY') ??
        this.config.get<string>('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ??
        '',
    ).trim();
    if (googleKey) {
      try {
        const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        url.searchParams.set('address', 'Montreal');
        url.searchParams.set('key', googleKey);
        const res = await this.fetchWithTimeout(url.toString(), 7000);
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
        };
        engines.push({
          name: 'Google Maps',
          configured: true,
          ok:
            res.ok &&
            (body.status === 'OK' || body.status === 'ZERO_RESULTS'),
          detail:
            body.status === 'OK' || body.status === 'ZERO_RESULTS'
              ? 'joignable'
              : body.status
                ? String(body.status).toLowerCase()
                : `HTTP ${res.status}`,
        });
      } catch (e) {
        engines.push({
          name: 'Google Maps',
          configured: true,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      engines.push({
        name: 'Google Maps',
        configured: false,
        ok: false,
        detail: 'non configuré',
      });
    }

    const geocodingEngine = String(
      this.config.get<string>('MAP_GEOCODING_ENGINE') ?? 'mapbox',
    )
      .trim()
      .toLowerCase();
    const nominatimBase = String(
      this.config.get<string>('OSM_NOMINATIM_BASE_URL') ??
        'https://nominatim.openstreetmap.org',
    ).trim();
    let osmContexts: string[] = [];
    let mapDefaults = '';
    try {
      const mapSettings = await this.mapSettings.getPublicSettings();
      if (mapSettings.vendor.osmEnabled) osmContexts.push('vendor');
      if (mapSettings.mobileUser.osmEnabled) osmContexts.push('mobileUser');
      if (mapSettings.mobileDelivery.osmEnabled) {
        osmContexts.push('mobileDelivery');
      }
      mapDefaults = `défauts vendor=${mapSettings.vendor.defaultMapEngine} user=${mapSettings.mobileUser.defaultMapEngine} delivery=${mapSettings.mobileDelivery.defaultMapEngine}`;
    } catch (e) {
      mapDefaults = `config carte: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }
    const mapPlatformConfig = `contextes OSM: ${
      osmContexts.length ? osmContexts.join('+') : 'aucun'
    } · ${mapDefaults}`;
    const osmAppsEnabled = osmContexts.length > 0 || geocodingEngine === 'osm';

    try {
      const results = await osmForwardGeocode('Montreal', this.config, {
        limit: 1,
      });
      engines.push({
        name: 'OpenStreetMap',
        configured: true,
        ok: results.length > 0,
        detail:
          (results.length > 0
            ? `Nominatim joignable (${nominatimBase})`
            : `Nominatim sans résultat (${nominatimBase})`) +
          ` · MAP_GEOCODING_ENGINE=${geocodingEngine}` +
          (osmAppsEnabled ? '' : ' · OSM non activé côté apps') +
          ` · ${mapPlatformConfig}`,
      });
    } catch (e) {
      engines.push({
        name: 'OpenStreetMap',
        configured: true,
        ok: false,
        detail: `${
          e instanceof Error ? e.message : String(e)
        } · MAP_GEOCODING_ENGINE=${geocodingEngine} · ${mapPlatformConfig}`,
      });
    }

    const configured = engines.filter((e) => e.configured);
    const okCount = configured.filter((e) => e.ok).length;
    let status: SystemHealthCheckResult['status'] = 'down';
    if (configured.length === 0) {
      status = 'down';
    } else if (okCount === configured.length) {
      status = 'healthy';
    } else if (okCount > 0) {
      status = 'degraded';
    } else {
      status = 'down';
    }

    const details = engines
      .map((e) => `${e.name} : ${e.configured ? e.detail : 'non configuré'}`)
      .join(' · ');

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details,
    });
  }

  private async runFileStorageEnginesHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'file-storage-engines-status';
    const label = 'File storage engines status';

    const engines: Array<{
      name: string;
      configured: boolean;
      ok: boolean;
      detail: string;
    }> = [];

    const firebaseBucket =
      String(this.config.get<string>('AM_FIREBASE_STORAGE_BUCKET') ?? '').trim() ||
      String(this.firebaseApp?.options?.storageBucket ?? '').trim();
    if (firebaseBucket) {
      try {
        const [exists] = await getStorage(this.firebaseApp)
          .bucket(firebaseBucket)
          .exists();
        engines.push({
          name: 'Firebase Storage',
          configured: true,
          ok: Boolean(exists),
          detail: exists ? 'joignable' : 'bucket introuvable',
        });
      } catch (e) {
        engines.push({
          name: 'Firebase Storage',
          configured: true,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      engines.push({
        name: 'Firebase Storage',
        configured: false,
        ok: false,
        detail: 'non configuré',
      });
    }

    const gcsBucket =
      String(this.config.get<string>('GCS_BUCKET') ?? '').trim() ||
      String(this.config.get<string>('GOOGLE_CLOUD_STORAGE_BUCKET') ?? '').trim();
    if (gcsBucket) {
      try {
        const { Storage } = await import('@google-cloud/storage');
        const sa = loadFirebaseServiceAccount(this.config);
        const clientEmail = String(sa?.client_email ?? '').trim();
        const privateKey = String(sa?.private_key ?? '').trim();
        const projectId = String(sa?.project_id ?? '').trim();
        const storage =
          clientEmail && privateKey
            ? new Storage({
                ...(projectId ? { projectId } : {}),
                credentials: {
                  client_email: clientEmail,
                  private_key: privateKey.replace(/\\n/g, '\n'),
                },
              })
            : new Storage();
        const [exists] = await storage.bucket(gcsBucket).exists();
        engines.push({
          name: 'Google Cloud Storage',
          configured: true,
          ok: Boolean(exists),
          detail: exists ? 'joignable' : 'bucket introuvable',
        });
      } catch (e) {
        engines.push({
          name: 'Google Cloud Storage',
          configured: true,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      engines.push({
        name: 'Google Cloud Storage',
        configured: false,
        ok: false,
        detail: 'non configuré',
      });
    }

    const s3Bucket = String(this.config.get<string>('AWS_S3_BUCKET') ?? '').trim();
    const s3Key = String(this.config.get<string>('AWS_ACCESS_KEY_ID') ?? '').trim();
    const s3Secret = String(
      this.config.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
    ).trim();
    if (s3Bucket && s3Key && s3Secret) {
      try {
        const { HeadBucketCommand, S3Client } = await import('@aws-sdk/client-s3');
        const region =
          String(this.config.get<string>('AWS_REGION') ?? '').trim() || 'us-east-1';
        const client = new S3Client({
          region,
          credentials: { accessKeyId: s3Key, secretAccessKey: s3Secret },
        });
        await client.send(new HeadBucketCommand({ Bucket: s3Bucket }));
        engines.push({
          name: 'Amazon S3',
          configured: true,
          ok: true,
          detail: 'joignable',
        });
      } catch (e) {
        engines.push({
          name: 'Amazon S3',
          configured: true,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      engines.push({
        name: 'Amazon S3',
        configured: false,
        ok: false,
        detail: 'non configuré',
      });
    }

    const minioBucket = String(this.config.get<string>('MINIO_BUCKET') ?? '').trim();
    const minioKey = String(this.config.get<string>('MINIO_ACCESS_KEY') ?? '').trim();
    const minioSecret = String(
      this.config.get<string>('MINIO_SECRET_KEY') ?? '',
    ).trim();
    const minioEndpoint = String(
      this.config.get<string>('MINIO_ENDPOINT') ?? '',
    ).trim();
    const minioProbeSkip = resolveMinioHealthProbeSkipReason(this.config);
    if (minioProbeSkip) {
      engines.push({
        name: 'MinIO',
        configured: false,
        ok: false,
        detail: minioProbeSkip,
      });
    } else if (minioBucket && minioKey && minioSecret && minioEndpoint) {
      try {
        const { HeadBucketCommand, S3Client } = await import('@aws-sdk/client-s3');
        const region =
          String(this.config.get<string>('MINIO_REGION') ?? '').trim() ||
          'us-east-1';
        const endpoint = minioEndpoint.startsWith('http')
          ? minioEndpoint
          : `http://${minioEndpoint}`;
        const forcePathStyle =
          String(this.config.get<string>('MINIO_FORCE_PATH_STYLE') ?? '').trim() !==
          'false';
        const client = new S3Client({
          region,
          endpoint,
          forcePathStyle,
          credentials: { accessKeyId: minioKey, secretAccessKey: minioSecret },
        });
        await client.send(new HeadBucketCommand({ Bucket: minioBucket }));
        engines.push({
          name: 'MinIO',
          configured: true,
          ok: true,
          detail: 'joignable',
        });
      } catch (e) {
        engines.push({
          name: 'MinIO',
          configured: true,
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } else {
      engines.push({
        name: 'MinIO',
        configured: false,
        ok: false,
        detail: 'non configuré',
      });
    }

    const configured = engines.filter((e) => e.configured);
    const okCount = configured.filter((e) => e.ok).length;
    let status: SystemHealthCheckResult['status'] = 'down';
    if (configured.length === 0) {
      status = 'down';
    } else if (okCount === configured.length) {
      status = 'healthy';
    } else if (okCount > 0) {
      status = 'degraded';
    } else {
      status = 'down';
    }

    const details = engines
      .map((e) => `${e.name} : ${e.configured ? e.detail : 'non configuré'}`)
      .join(' · ');

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details,
    });
  }

  private async runMailHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'mail-health-status';
    const label = 'Mail health status';

    const snapshot = await this.platformChannels.getEmailEnginesHealthSnapshot();

    const formatRow = (row: (typeof snapshot.rows)[number]): string => {
      const cfg = row.configured ? 'config✓' : 'config✗';
      let health = 'health—';
      if (row.healthOk === true) health = 'health✓';
      else if (row.healthOk === false) health = 'health✗';
      const global = row.globalActive ? ' [global]' : '';
      return `${row.label}${global}: ${cfg}, ${health} (${row.healthDetail})`;
    };

    const globalRouter = snapshot.rows.find(
      (row) =>
        row.globalActive &&
        (row.engine === 'any' || row.engine === 'auto'),
    );
    if (globalRouter && !globalRouter.configured) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details: `Moteur global « ${globalRouter.label} » non configuré · global=${snapshot.globalEngine} · ${snapshot.rows.map(formatRow).join(' · ')}`,
      });
    }

    const concreteConfigured = snapshot.rows.filter(
      (row) =>
        row.configured &&
        row.engine !== 'any' &&
        row.engine !== 'auto',
    );
    const withHealth = concreteConfigured.filter((row) => row.healthOk !== null);
    const okCount = withHealth.filter((row) => row.healthOk === true).length;
    const failCount = withHealth.filter((row) => row.healthOk === false).length;

    let status: SystemHealthCheckResult['status'] = 'down';
    if (concreteConfigured.length === 0) {
      status = 'down';
    } else if (failCount === 0 && okCount === withHealth.length) {
      status = 'healthy';
    } else if (okCount > 0) {
      status = 'degraded';
    } else {
      status = 'down';
    }

    const details = `global=${snapshot.globalEngine} · ${snapshot.rows.map(formatRow).join(' · ')}`;

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details,
    });
  }

  private async runFirebaseServicesHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'firebase-services-status';
    const label = 'Firebase services status';

    const projectId = String(this.firebaseApp?.options?.projectId ?? '').trim();
    if (!projectId) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'down',
        details:
          'Firebase Admin projectId manquant (AM_FIREBASE_PROJECT_ID / service account).',
      });
    }

    const checks: Array<{ id: string; ok: boolean; details: string }> = [];

    try {
      await getAuth(this.firebaseApp).listUsers(1);
      checks.push({ id: 'auth', ok: true, details: 'Auth OK' });
    } catch (e) {
      checks.push({
        id: 'auth',
        ok: false,
        details: `Auth KO: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    try {
      const appName = getMessaging(this.firebaseApp).app.name;
      checks.push({
        id: 'messaging',
        ok: true,
        details: `Messaging initialized (${appName})`,
      });
    } catch (e) {
      checks.push({
        id: 'messaging',
        ok: false,
        details: `Messaging KO: ${e instanceof Error ? e.message : String(e)}`,
      });
    }

    const bucketName =
      String(
        this.config.get<string>('AM_FIREBASE_STORAGE_BUCKET') ?? '',
      ).trim() || String(this.firebaseApp.options.storageBucket ?? '').trim();
    if (!bucketName) {
      checks.push({
        id: 'storage',
        ok: false,
        details: 'Storage bucket manquant (AM_FIREBASE_STORAGE_BUCKET).',
      });
    } else {
      try {
        const [exists] = await getStorage(this.firebaseApp)
          .bucket(bucketName)
          .exists();
        checks.push({
          id: 'storage',
          ok: Boolean(exists),
          details: exists
            ? `Storage bucket OK (${bucketName})`
            : `Storage bucket introuvable (${bucketName})`,
        });
      } catch (e) {
        checks.push({
          id: 'storage',
          ok: false,
          details: `Storage KO: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }

    const okCount = checks.filter((c) => c.ok).length;
    const status: SystemHealthCheckResult['status'] =
      okCount === checks.length ? 'healthy' : okCount > 0 ? 'degraded' : 'down';
    const details = checks
      .map((c) => `${c.id}:${c.ok ? 'ok' : 'ko'} (${c.details})`)
      .join(' | ');

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details,
    });
  }

  private async runBirdSmsApiHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'bird-sms-api-status';
    const label = 'SMS API status';
    const env = process.env;
    const config = readBirdSmsConfig(env);
    const smsEnabled = isAdNotificationSmsEnabled(env);

    if (!config) {
      const partial =
        Boolean(env.BIRD_ACCESS_KEY?.trim()) ||
        Boolean(env.BIRD_WORKSPACE_ID?.trim()) ||
        Boolean(env.BIRD_SMS_CHANNEL_ID?.trim());
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'degraded',
        details: partial
          ? 'Canal SMS incomplet : credentials requis (ACCESS_KEY, WORKSPACE_ID, SMS_CHANNEL_ID).'
          : 'Canal SMS non configuré (optionnel si SMS Ads désactivé).',
      });
    }

    const probe = await probeBirdChannelApi({
      config,
      channelId: config.smsChannelId!,
    });
    if (!probe.ok) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: smsEnabled ? 'down' : 'degraded',
        details: smsEnabled
          ? `SMS API KO: ${probe.error ?? 'unknown'}`
          : `Canal SMS ads désactivé — probe Bird: ${probe.error ?? 'unknown'}`,
      });
    }

    const channelLine = [probe.channelName, probe.platform]
      .filter(Boolean)
      .join(' · ');
    const adsFlag = smsEnabled
      ? 'AD_NOTIFICATION_SMS_ENABLED=true'
      : 'AD_NOTIFICATION_SMS_ENABLED≠true (API OK, envoi ads désactivé)';

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status: smsEnabled ? 'healthy' : 'degraded',
      details: `SMS API OK (${channelLine || config.smsChannelId}) · ${adsFlag}`,
    });
  }

  private async runBirdWhatsAppApiHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'bird-whatsapp-api-status';
    const label = 'WhatsApp API status';
    const env = await this.platformChannels.getBirdWhatsAppMergedEnv();
    const config = readBirdWhatsAppConfig(env);
    const waEnabled = isAdNotificationWhatsAppEnabled(env);

    if (!config) {
      const partial =
        Boolean(env.BIRD_ACCESS_KEY?.trim()) ||
        Boolean(env.BIRD_WORKSPACE_ID?.trim()) ||
        Boolean(env.BIRD_WHATSAPP_CHANNEL_ID?.trim());
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: 'degraded',
        details: partial
          ? 'Canal WhatsApp incomplet : credentials requis (ACCESS_KEY, WORKSPACE_ID, WHATSAPP_CHANNEL_ID).'
          : 'Canal WhatsApp non configuré (optionnel si canal désactivé).',
      });
    }

    const probe = await probeBirdChannelApi({
      config,
      channelId: config.whatsappChannelId!,
    });
    if (!probe.ok) {
      return this.normalizeHealthResult({
        key,
        label,
        startedAtMs,
        status: waEnabled ? 'down' : 'degraded',
        details: waEnabled
          ? `WhatsApp API KO: ${probe.error ?? 'unknown'}`
          : `Canal WhatsApp ads désactivé — probe Bird: ${probe.error ?? 'unknown'}`,
      });
    }

    const line = [probe.channelName, probe.platform, config.whatsappChannelId]
      .filter(Boolean)
      .join(' · ');
    const adsFlag = waEnabled
      ? 'AD_NOTIFICATION_WHATSAPP_ENABLED=true'
      : 'AD_NOTIFICATION_WHATSAPP_ENABLED≠true (API OK, envoi ads désactivé)';

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status: waEnabled ? 'healthy' : 'degraded',
      details: `WhatsApp API OK (${line}) · ${adsFlag}`,
    });
  }

  private async runAdNotificationChannelsHealthCheck(): Promise<SystemHealthCheckResult> {
    const startedAtMs = Date.now();
    const key = 'ad-notification-channels-status';
    const label = 'Ad notification channels status';

    const [pricingDoc, infra, firebaseMessagingOk, wsReachable] =
      await Promise.all([
        this.adNotificationPricingModel
          .findOne({ key: 'default' })
          .select('availableChannels')
          .lean()
          .exec(),
        this.ensureInfraRuntimeSettings(),
        this.isFirebaseMessagingReady(),
        this.isWsHealthReachable(),
      ]);

    const availability = parseAvailableChannelsFromDoc(
      pricingDoc as Record<string, unknown> | null | undefined,
    );
    const evaluation = evaluateAdNotificationChannelHealth({
      availability,
      env: this.adNotificationProcessEnv(),
      firebaseMessagingOk,
      wsReachable,
      pricingDocFound: pricingDoc != null,
      mqBrokerEnabled: infra.mqBrokerEnabled === true,
    });
    const { status, details } = channelHealthSummary(evaluation);

    return this.normalizeHealthResult({
      key,
      label,
      startedAtMs,
      status,
      details,
    });
  }

  private async fetchWithTimeout(
    url: string,
    timeoutMs: number,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        signal: controller.signal,
        method: 'GET',
        ...(init ?? {}),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchStripePaymentsById(
    paymentIds: string[],
  ): Promise<
    Map<string, { status: string; isPaid: boolean; amountCents: number }>
  > {
    const out = new Map<
      string,
      { status: string; isPaid: boolean; amountCents: number }
    >();
    const stripe = this.stripeClient();
    if (!stripe) return out;

    for (const id of paymentIds) {
      try {
        if (id.startsWith('pi_')) {
          const pi = await stripe.paymentIntents.retrieve(id);
          out.set(id, {
            status: String(pi.status ?? 'unknown'),
            isPaid: pi.status === 'succeeded',
            amountCents:
              typeof pi.amount_received === 'number'
                ? pi.amount_received
                : typeof pi.amount === 'number'
                ? pi.amount
                : 0,
          });
          continue;
        }
        if (id.startsWith('cs_')) {
          const session = await stripe.checkout.sessions.retrieve(id);
          out.set(id, {
            status: String(
              session.payment_status ?? session.status ?? 'unknown',
            ),
            isPaid: session.payment_status === 'paid',
            amountCents:
              typeof session.amount_total === 'number'
                ? session.amount_total
                : 0,
          });
        }
      } catch (e) {
        this.logger.warn(
          `Integrity order-payment-test: Stripe lookup failed for ${id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return out;
  }

  private getIntegrityScanLimit(): number {
    const raw = Number(
      this.config.get<string>('INTEGRITY_TEST_SCAN_LIMIT') ?? '5000',
    );
    if (!Number.isFinite(raw)) return 5000;
    return Math.max(100, Math.min(50000, Math.trunc(raw)));
  }

  private getCreatedOrderMaxAgeHours(): number {
    const raw = Number(
      this.config.get<string>('INTEGRITY_CREATED_ORDER_MAX_AGE_HOURS') ?? '2',
    );
    if (!Number.isFinite(raw)) return 2;
    return Math.max(1, Math.min(72, raw));
  }

  private toListItem(
    def: DbClearableTableDef,
    documentCount: number,
  ): DbTableListItem {
    return {
      key: def.key,
      collection: def.collection,
      labelFr: def.labelFr,
      labelEn: def.labelEn,
      category: def.category,
      critical: !!def.critical,
      documentCount,
    };
  }

  private async countCollection(
    db: NonNullable<Connection['db']>,
    def: DbClearableTableDef,
  ): Promise<number> {
    try {
      return await db.collection(def.collection).countDocuments();
    } catch {
      return 0;
    }
  }

  async getEmailDebugContext(user: UserModel) {
    await this.assertAdminSettingsPermission(user);

    const orders = await this.orderModel
      .find({ status: { $nin: [OrderStatusEnum.CREATED, OrderStatusEnum.CANCELLED] } })
      .sort({ createdAt: -1 })
      .limit(40)
      .populate('store', 'name')
      .populate('user', 'email fullName')
      .select(
        '_id status totalPrice currency shouldShip createdAt store user',
      )
      .lean()
      .exec();

    const smtpFrom = this.orderPaidInvoiceEmail.resolveSmtpFromAddress();
    const smtpConfigured = this.orderPaidInvoiceEmail.isSmtpConfigured();

    return {
      smtp: {
        configured: smtpConfigured,
        host: this.config.get<string>('SMTP_HOST')?.trim() || 'smtp.gmail.com',
        from: smtpFrom,
        user: this.config.get<string>('SMTP_USER')?.trim() || '',
      },
      templates: {
        paidReceiptEnabled: this.orderPaidInvoiceEmail.isEnabled(),
        shippedEnabled: this.orderPaidInvoiceEmail.isShippedEnabled(),
      },
      links: {
        markupTester:
          'https://developers.google.com/workspace/gmail/markup/testing-your-schema',
        registerWithGoogle:
          'https://developers.google.com/workspace/gmail/markup/registering-with-google',
        allowlistForm:
          'https://docs.google.com/forms/d/e/1FAIpQLSfT5F1VJXtBjGw2mLxY2aX557ctPTsCrJpURiKJjYeVrugHBQ/viewform',
        schemaSampleEmail: 'schema.whitelisting+sample@gmail.com',
      },
      checklist: [
        'Carte résumé au-dessus du corps (commande, total, statut) si Google a whitelisté le domaine.',
        'Onglet Achats Gmail (mobile) : regroupement avec d’autres reçus.',
        'JSON-LD dans <head> — pas seulement dans le corps.',
        'SPF + DKIM alignés sur le domaine From (@wise-eat.com).',
        'Attendre 1–5 min après réception avant de vérifier l’affichage.',
      ],
      troubleshooting: [
        'Balise <script type="application/ld+json"> supprimée par certains clients.',
        'Erreur JSON-LD — valider sur Email Markup Tester.',
        'From @wise-eat.com sans enregistrement Google — pas de carte Achats pour les clients.',
        'Test sans whitelist : From et To identiques sur le même @gmail.com.',
      ],
      orders: orders.map((o) => {
        const id = String(o._id);
        const store = o.store as { name?: string } | null | undefined;
        const user = o.user as
          | { email?: string; fullName?: string }
          | null
          | undefined;
        return {
          id,
          ref: orderInvoiceRef(id),
          status: String(o.status ?? ''),
          storeName: store?.name?.trim() || 'Restaurant',
          clientEmail: user?.email?.trim() || '',
          clientName: user?.fullName?.trim() || '',
          totalPrice: Number(o.totalPrice) || 0,
          currency: typeof o.currency === 'string' ? o.currency : 'CAD',
          shouldShip: Boolean(o.shouldShip),
          createdAt: o.createdAt,
        };
      }),
    };
  }

  async sendOrderEmailDebug(
    user: UserModel,
    dto: SendOrderEmailDebugDto,
  ): Promise<{ result: OrderEmailDebugSendResult }> {
    await this.assertAdminSettingsPermission(user);
    const result = await this.orderPaidInvoiceEmail.sendDebugOrderEmail(
      dto.orderId.trim(),
      dto.variant as OrderEmailVariant,
      dto.toEmail.trim(),
    );
    return { result };
  }
}
