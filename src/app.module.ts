import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';

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
  ],
  controllers: [AppController],
  providers: [AppService],
  // exports: [ConfigModule],
})
export class AppModule {}
