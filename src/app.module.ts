require("node:dns/promises").setServers(["1.1.1.1", "8.8.8.8"]);
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
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { BillingModule } from './modules/billing/billing.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';

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
        // Logger.warn('🚀 ~ DB Setup ...', 'MAIN');
        // Logger.warn(config.get<string>('MONGO_URI'), 'MAIN');
        const uri = `mongodb+srv://${config.get<string>(
          'DB_USERNAME',
        )}:${config.get<string>('DB_PASSWORD')}@${config.get<string>(
          'DB_HOST',
        )}?retryWrites=true&w=majority&appName=Main`;
        // console.log('🚀 ~ uri:', uri);
        return {
          uri,
          dbName: config.get<string>('DB_DATABASE'),
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
    AnnouncementsModule,
    BillingModule,
    OrdersModule,
    SupportChatModule,
    // SharedModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  // exports: [ConfigModule],
})
export class AppModule {}
