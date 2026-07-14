import { SharedModule } from '@modules/shared/shared.module';
import { StoreAccessModule } from '@modules/teams/store-access.module';
import { VendorNotificationModule } from '@modules/vendor-notifications/vendor-notification.module';
import { Module, forwardRef } from '@nestjs/common';
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
import { AppInboxNotificationsController } from './app-inbox-notifications.controller';
import { InternalNotificationsController } from './internal-notifications.controller';
import { InternalSecretGuard } from './guards/internal-secret.guard';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    SharedModule,
    StoreAccessModule,
    // Prefs vendeur (`categories.chat.push`) — forwardRef car VendorNotification → Notifications.
    forwardRef(() => VendorNotificationModule),
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: AppNotificationModel.name, schema: AppNotificationSchema },
      {
        name: NotificationReadReceiptModel.name,
        schema: NotificationReadReceiptSchema,
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
