import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
import { AdsModule } from './modules/ads/ads.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { BillingModule } from './modules/billing/billing.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SeedModule } from './modules/seed/seed.module';
import { SupportedCountriesModule } from './modules/supported-countries/supported-countries.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ['.env', '../.env'],
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const fullUri =
          config.get<string>('MONGODB_URI') ||
          config.get<string>('MONGO_URI') ||
          '';
        const builtUri = `mongodb+srv://${config.get<string>(
          'DB_USERNAME',
        )}:${config.get<string>('DB_PASSWORD')}@${config.get<string>(
          'DB_HOST',
        )}?retryWrites=true&w=majority&appName=Main`;

        const uri = fullUri || builtUri;
        const dbName = config.get<string>('DB_DATABASE');

        return {
          uri,
          ...(dbName ? { dbName } : {}),
          maxPoolSize: Number(config.get<string>('MONGOOSE_MAX_POOL') || 10),
          serverSelectionTimeoutMS: Number(
            config.get<string>('MONGOOSE_SERVER_SELECTION_MS') || 8000,
          ),
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
    AdsModule,
    AnnouncementsModule,
    BillingModule,
    OrdersModule,
    SeedModule,
    SupportedCountriesModule,
    // SharedModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  // exports: [ConfigModule],
})
export class AppModule {}
