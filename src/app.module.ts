import { CacheModule } from '@nestjs/cache-manager';
import { Logger, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EnvDebugController } from './env-debug.controller';
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
import { TeamsModule } from './modules/teams/teams.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { PlatformShippingSettingsModule } from './modules/platform-shipping-settings/platform-shipping-settings.module';
import { buildMongooseRootOptions } from './config/mongoose-connection.factory';
import { AppPoliciesModule } from './modules/app-policies/app-policies.module';
import { DbMaintenanceModule } from './modules/db-maintenance/db-maintenance.module';
import { RequestStatsModule } from './modules/request-stats/request-stats.module';
import { FieldSelectionModule } from './common/field-selection/field-selection.module';
import { MobileAppSettingsModule } from './modules/mobile-app-settings/mobile-app-settings.module';
import { AdsTargetingModule } from './modules/ads-targeting/ads-targeting.module';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function parseRedisPort(raw: string | undefined): number {
  return parsePositiveInt(raw, 6379);
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
    ? `${encodeURIComponent(username || 'default')}:${encodeURIComponent(password)}@`
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
        const max = parsePositiveInt(config.get<string>('CACHE_MAX_ITEMS'), 500);
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
    TeamsModule,
    RefundsModule,
    PenaltiesModule,
    AppPoliciesModule,
    DbMaintenanceModule,
    RequestStatsModule,
    FieldSelectionModule,
    MobileAppSettingsModule,
    AdsTargetingModule,
    // SharedModule,
  ],
  controllers: [AppController, EnvDebugController],
  providers: [AppService],
  // exports: [ConfigModule],
})
export class AppModule {}
