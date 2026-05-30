import { SharedModule } from '@modules/shared/shared.module';
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
import { AppInboxNotificationsController } from './app-inbox-notifications.controller';
import { InternalNotificationsController } from './internal-notifications.controller';
import { InternalSecretGuard } from './guards/internal-secret.guard';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    SharedModule,
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
