import { AuthSettingsModule } from '@modules/auth-settings/auth-settings.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { MediasModule } from '@modules/medias/medias.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { SharedModule } from '@modules/shared/shared.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
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
import { LoginNotificationService } from './login-notification/login-notification.service';
import { AccountDeletionCron } from './account-deletion.cron';
import { AdminGuard } from './guards/admin.guard';
import { JwtGuard } from './guards/jwt.guard';
import { OptionalAuthGuard } from './guards/optional.auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailerTestEmailController } from '@modules/mailer/mailer-test-email.controller';
import { MailerTestEmailRateLimitGuard } from '@modules/mailer/guards/mailer-test-email-rate-limit.guard';
import { isMailerTestEmailEnabled } from '@modules/mailer/mailer-test-email.util';
import { RedisSharedModule } from '../../common/redis/redis-shared.module';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { RefreshTokenStore } from './refresh-token.store';
import { OtpLinkTokenStore } from './otp-link-token.store';
import { JwtSecretsBootstrapService } from './jwt-secrets-bootstrap.service';

@Module({
  controllers: [
    AuthController,
    FcmTestController,
    ...(isMailerTestEmailEnabled() ? [MailerTestEmailController] : []),
  ],
  providers: [
    AuthService,
    LoginNotificationService,
    JwtStrategy,
    JwtGuard,
    OptionalAuthGuard,
    AdminGuard,
    MailerTestEmailRateLimitGuard,
    AuthRateLimitGuard,
    RefreshTokenStore,
    OtpLinkTokenStore,
    JwtSecretsBootstrapService,
    AccountDeletionCron,
  ],
  imports: [
    PassportModule,
    SharedModule,
    RedisSharedModule,
    MailerModule,
    MediasModule,
    NotificationsModule,
    SupportedCountriesModule,
    TeamsModule,
    LoyaltyModule,
    AuthSettingsModule,
    VendorStatusEmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRATION') ?? '30m',
        },
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
    AdminGuard,
  ],
})
export class AuthModule {}
