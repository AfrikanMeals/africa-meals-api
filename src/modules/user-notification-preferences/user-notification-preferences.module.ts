import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UserNotificationPreferencesModel,
  UserNotificationPreferencesSchema,
} from '@schemas/user-notification-preferences.schema';
import { UserNotificationPreferencesController } from './user-notification-preferences.controller';
import { UserNotificationPreferencesService } from './user-notification-preferences.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: UserNotificationPreferencesModel.name,
        schema: UserNotificationPreferencesSchema,
      },
    ]),
  ],
  controllers: [UserNotificationPreferencesController],
  providers: [UserNotificationPreferencesService],
  exports: [UserNotificationPreferencesService],
})
export class UserNotificationPreferencesModule {}
