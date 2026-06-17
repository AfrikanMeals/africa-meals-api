import { CacheModule } from '@nestjs/cache-manager';
import { Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EnvDebugController } from './env-debug.controller';
import { isEnvDebugControllerEnabled } from './env-debug.util';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailerModule } from './modules/mailer/mailer.module';
import { MediasModule } from './modules/medias/medias.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { StoreModule } from './modules/store/store.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { SearchModule } from './modules/search/search.module';
import { OffersModule } from './modules/offers/offers.module';
import { CartModule } from './modules/cart/cart.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { BillingModule } from './modules/billing/billing.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DeliveryAgentModule } from './modules/delivery-agent/delivery-agent.module';
import { GraphqlApiModule } from './graphql/graphql.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { PlatformFeesModule } from './modules/platform-fees/platform-fees.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PartnerBadgesModule } from './modules/partner-badges/partner-badges.module';
import { TeamsModule } from './modules/teams/teams.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { PlatformShippingSettingsModule } from './modules/platform-shipping-settings/platform-shipping-settings.module';
import { buildMongooseRootOptions } from './config/mongoose-connection.factory';
import { AppPoliciesModule } from './modules/app-policies/app-policies.module';
import { DocumentationModule } from './modules/documentation/documentation.module';
import { BlogModule } from './modules/blog/blog.module';
import { CronMonitorModule } from './modules/cron-monitor/cron-monitor.module';
import { DbMaintenanceModule } from './modules/db-maintenance/db-maintenance.module';
import { AdminOpsReportsModule } from './modules/admin-ops-reports/admin-ops-reports.module';
import { RequestStatsModule } from './modules/request-stats/request-stats.module';
import { FieldSelectionModule } from './common/field-selection/field-selection.module';
import { DomainEventsModule } from './common/domain-events/domain-events.module';
import { AuthSettingsModule } from './modules/auth-settings/auth-settings.module';
import { SecuritySettingsModule } from './modules/security-settings/security-settings.module';
import { StorageSettingsModule } from './modules/storage-settings/storage-settings.module';
import { MapSettingsModule } from './modules/map-settings/map-settings.module';
import { SearchSettingsModule } from './modules/search-settings/search-settings.module';
import { SecretManagerModule } from './modules/secret-manager/secret-manager.module';
import { MobileAppSettingsModule } from './modules/mobile-app-settings/mobile-app-settings.module';
import { PosSettingsModule } from './modules/pos-settings/pos-settings.module';
import { BusinessTypesModule } from './modules/business-types/business-types.module';
import { AdsTargetingModule } from './modules/ads-targeting/ads-targeting.module';
import { VendorNotificationModule } from './modules/vendor-notifications/vendor-notification.module';
import { DashboardAuditModule } from './modules/dashboard-audit/dashboard-audit.module';
import { GoogleMerchantModule } from './modules/google-merchant/google-merchant.module';
import { PublicSeoModule } from './modules/public-seo/public-seo.module';
import { SseStreamModule } from './modules/sse-stream/sse-stream.module';
import { DomainEventHandlersModule } from './modules/domain-event-handlers/domain-event-handlers.module';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function parseRedisPort(raw: string | undefined): number {
  return parsePositiveInt(raw, 6379);
}

function buildMongoUriFromConfig(config: ConfigService): string | null {
  const direct =
    config.get<string>('MONGODB_URI')?.trim() ||
    config.get<string>('MONGO_URI')?.trim();
  if (direct) return direct;
  const host = config.get<string>('DB_HOST')?.trim();
  const username = config.get<string>('DB_USERNAME')?.trim();
  const password = config.get<string>('DB_PASSWORD')?.trim();
  const dbName = config.get<string>('DB_DATABASE')?.trim() || '';
  if (!host || !username || !password) return null;
  const encodedUser = encodeURIComponent(username);
  const encodedPass = encodeURIComponent(password);
  const encodedDb = dbName ? `/${encodeURIComponent(dbName)}` : '';
  const appName = encodeURIComponent(
    config.get<string>('MONGODB_APP_NAME')?.trim() || 'africa-meals-api',
  );
  return `mongodb+srv://${encodedUser}:${encodedPass}@${host}${encodedDb}?retryWrites=true&w=majority&appName=${appName}`;
}

function mongoDbNameFromUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    const p = parsed.pathname?.replace(/^\/+/, '').trim();
    return p || null;
  } catch {
    return null;
  }
}

let redisBootstrapToggleCache: boolean | null = null;

async function readRedisManagerEnabledAtBootstrap(
  config: ConfigService,
): Promise<boolean> {
  if (redisBootstrapToggleCache != null) return redisBootstrapToggleCache;
  const uri = buildMongoUriFromConfig(config);
  if (!uri) {
    redisBootstrapToggleCache = true;
    return true;
  }
  let client: import('mongodb').MongoClient | null = null;
  try {
    const { MongoClient } = await import('mongodb');
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await client.connect();
    const dbName =
      mongoDbNameFromUri(uri) ||
      config.get<string>('DB_DATABASE')?.trim() ||
      '';
    const db = dbName ? client.db(dbName) : client.db();
    const doc = (await db
      .collection('infra_runtime_settings')
      .findOne(
        { key: 'default' },
        { projection: { redis_manager_enabled: 1, redisManagerEnabled: 1 } },
      )) as {
      redis_manager_enabled?: unknown;
      redisManagerEnabled?: unknown;
    } | null;
    const enabled = doc
      ? doc.redis_manager_enabled !== false && doc.redisManagerEnabled !== false
      : true;
    redisBootstrapToggleCache = enabled;
    return enabled;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Logger.warn(
      `Redis bootstrap toggle read failed (${msg}) -> default enabled`,
      'CacheModule',
    );
    redisBootstrapToggleCache = true;
    return true;
  } finally {
    await client?.close().catch(() => undefined);
  }
}

function buildRedisUrl(config: ConfigService): string | null {
  const direct = config.get<string>('REDIS_URL')?.trim();
  if (direct) return direct;

  const host = config.get<string>('REDIS_HOST')?.trim();
  if (!host) return null;
  const port = parseRedisPort(config.get<string>('REDIS_PORT'));
  const username = config.get<string>('REDIS_USERNAME')?.trim() ?? '';
  const password = config.get<string>('REDIS_PASSWORD')?.trim() ?? '';
  const auth = password
    ? `${encodeURIComponent(username || 'default')}:${encodeURIComponent(
        password,
      )}@`
    : '';
  return `redis://${auth}${host}:${port}`;
}

function redactRedisUrl(url: string): string {
  return url.replace(/:\/\/[^@]+@/, '://***:***@');
}

@Module({
  imports: [
    ConfigModule.forRoot({
      // `.env.local` est chargé en premier (secrets locaux) ; souvent absent du dépôt.
      envFilePath: ['.env.local', '.env', '../.env'],
      isGlobal: true,
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const ttl = parsePositiveInt(
          config.get<string>('FAVORITES_CACHE_TTL_MS'),
          25_000,
        );
        const max = parsePositiveInt(
          config.get<string>('CACHE_MAX_ITEMS'),
          500,
        );
        const redisManagerEnabled = await readRedisManagerEnabledAtBootstrap(
          config,
        );
        if (!redisManagerEnabled) {
          Logger.log(
            'Cache store: memory (redis disabled by runtime toggle at bootstrap)',
            'CacheModule',
          );
          return { ttl, max };
        }
        const redisUrl = buildRedisUrl(config);

        if (!redisUrl) {
          Logger.log('Cache store: memory (REDIS_* absent)', 'CacheModule');
          return { ttl, max };
        }

        try {
          const { redisStore } = await import('cache-manager-redis-yet');
          const store = await redisStore({
            url: redisUrl,
            ttl,
          });
          const redisClient = (
            store as { client?: { on?(event: string, cb: (err: Error) => void): void } }
          ).client;
          redisClient?.on?.('error', (err: Error) => {
            Logger.warn(
              `Redis cache client error: ${err.message}`,
              'CacheModule',
            );
          });
          Logger.log(
            `Cache store: redis (${redactRedisUrl(redisUrl)})`,
            'CacheModule',
          );
          return {
            ttl,
            max,
            store,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'unknown redis error';
          Logger.warn(
            `Cache Redis indisponible (${message}) -> fallback memory`,
            'CacheModule',
          );
          return { ttl, max };
        }
      },
    }),
    ScheduleModule.forRoot(),
    CronMonitorModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const opts = buildMongooseRootOptions(config, 'africa-meals-api');
        return {
          ...opts,
          connectionFactory: (connection: import('mongoose').Connection) => {
            connection.on('error', (err: Error) => {
              Logger.error(
                `MongoDB: ${err.message}`,
                err.stack,
                'MongooseModule',
              );
            });
            return connection;
          },
        };
      },
    }),
    AuthModule,
    UsersModule,
    MailerModule,
    StoreModule,
    RatingsModule,
    AddressesModule,
    MediasModule,
    ProductsModule,
    SearchModule,
    OffersModule,
    CartModule,
    CouponsModule,
    AnnouncementsModule,
    BillingModule,
    LoyaltyModule,
    OrdersModule,
    SupportChatModule,
    DashboardModule,
    DeliveryAgentModule,
    GraphqlApiModule,
    RecommendationsModule,
    PlatformShippingSettingsModule,
    PlatformFeesModule,
    SubscriptionsModule,
    PartnerBadgesModule,
    TeamsModule,
    RefundsModule,
    PenaltiesModule,
    AppPoliciesModule,
    DocumentationModule,
    BlogModule,
    DbMaintenanceModule,
    AdminOpsReportsModule,
    RequestStatsModule,
    FieldSelectionModule,
    DomainEventsModule,
    AuthSettingsModule,
    SecuritySettingsModule,
    StorageSettingsModule,
    MapSettingsModule,
    SearchSettingsModule,
    SecretManagerModule,
    MobileAppSettingsModule,
    PosSettingsModule,
    BusinessTypesModule,
    AdsTargetingModule,
    VendorNotificationModule,
    DashboardAuditModule,
    GoogleMerchantModule,
    PublicSeoModule,
    SseStreamModule,
    DomainEventHandlersModule,
    // SharedModule,
  ],
  controllers: [
    AppController,
    ...(isEnvDebugControllerEnabled() ? [EnvDebugController] : []),
  ],
  providers: [AppService],
  // exports: [ConfigModule],
})
export class AppModule {}
