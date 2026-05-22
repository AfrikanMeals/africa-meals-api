import { MailerModule } from '@modules/mailer/mailer.module';
import { MediasModule } from '@modules/medias/medias.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { SharedModule } from '@modules/shared/shared.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import {
  PendingSignupModel,
  PendingSignupSchema,
} from '@schemas/pending-signup.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { AuthController } from './auth.controller';
import { FcmTestController } from './fcm-test.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './guards/jwt.guard';
import { OptionalAuthGuard } from './guards/optional.auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  controllers: [AuthController, FcmTestController],
  providers: [AuthService, JwtStrategy, JwtGuard, OptionalAuthGuard],
  imports: [
    PassportModule,
    SharedModule,
    MailerModule,
    MediasModule,
    NotificationsModule,
    SupportedCountriesModule,
    TeamsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRATION') },
        global: true,
      }),
    }),
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: PendingSignupModel.name, schema: PendingSignupSchema },
    ]),
  ],
  exports: [
    AuthService,
    MongooseModule,
    JwtModule,
    JwtStrategy,
    JwtGuard,
    OptionalAuthGuard,
  ],
})
export class AuthModule {}
