import { SharedModule } from '@modules/shared/shared.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { InternalNotificationsController } from './internal-notifications.controller';
import { InternalSecretGuard } from './guards/internal-secret.guard';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    SharedModule,
    MongooseModule.forFeature([{ name: UserModel.name, schema: UserSchema }]),
  ],
  controllers: [InternalNotificationsController],
  providers: [NotificationsService, InternalSecretGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
