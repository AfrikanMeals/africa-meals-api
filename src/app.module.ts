require("node:dns/promises").setServers(["1.1.1.1", "8.8.8.8"]);
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
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
import { OrdersModule } from './modules/orders/orders.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { GraphqlApiModule } from './graphql/graphql.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { buildMongooseRootOptions } from './config/mongoose-connection.factory';

@Module({
  imports: [
    ConfigModule.forRoot({
      // `.env.local` est chargé en premier (secrets locaux) ; souvent absent du dépôt.
      envFilePath: ['.env.local', '.env', '../.env'],
      isGlobal: true,
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: Number(process.env.FAVORITES_CACHE_TTL_MS) || 25_000,
      max: Number(process.env.CACHE_MAX_ITEMS) || 500,
    }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildMongooseRootOptions(config, 'africa-meals-api'),
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
    OrdersModule,
    SupportChatModule,
    DashboardModule,
    GraphqlApiModule,
    RecommendationsModule,
    // SharedModule,
  ],
  controllers: [AppController, EnvDebugController],
  providers: [AppService],
  // exports: [ConfigModule],
})
export class AppModule {}
