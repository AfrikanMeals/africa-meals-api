import { SharedModule } from '@modules/shared/shared.module';
import { StoreAccessModule } from '@modules/teams/store-access.module';
import { UserNotificationPreferencesModule } from '@modules/user-notification-preferences/user-notification-preferences.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AppNotificationModel,
  AppNotificationSchema,
} from '@schemas/app-notification.schema';
import {
  NotificationReadReceiptModel,
  NotificationReadReceiptSchema,
} from '@schemas/notification-read-receipt.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import {
  VendorNotificationPreferencesModel,
  VendorNotificationPreferencesSchema,
} from '@schemas/vendor-notification-preferences.schema';
import { AppInboxNotificationsController } from './app-inbox-notifications.controller';
import { InternalNotificationsController } from './internal-notifications.controller';
import { InternalSecretGuard } from './guards/internal-secret.guard';
import { NotificationsService } from './notifications.service';

/**
 * Pas d’import de VendorNotificationModule ici : il importe déjà NotificationsModule
 * → cycle Nest (`VendorNotificationModule imports[2] undefined`).
 * Prefs chat.push lues via le modèle Mongo enregistré ci-dessous.
 */
@Module({
  imports: [
    SharedModule,
    StoreAccessModule,
    UserNotificationPreferencesModule,
    MailerModule,
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: AppNotificationModel.name, schema: AppNotificationSchema },
      {
        name: NotificationReadReceiptModel.name,
        schema: NotificationReadReceiptSchema,
      },
      {
        name: VendorNotificationPreferencesModel.name,
        schema: VendorNotificationPreferencesSchema,
      },
    ]),
  ],
  controllers: [
    InternalNotificationsController,
    AppInboxNotificationsController,
  ],
  providers: [NotificationsService, InternalSecretGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
