import { MailerModule } from '@modules/mailer/mailer.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  StoreDeliveryDriverMembershipModel,
  StoreDeliveryDriverMembershipSchema,
} from '@schemas/store-delivery-driver-membership.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { PlatformStoreDriverInvitesController } from './platform-store-driver-invites.controller';
import { StoreDeliveryDriversService } from './store-delivery-drivers.service';

@Module({
  imports: [
    forwardRef(() => MailerModule),
    NotificationsModule,
    WsNotifyModule,
    MongooseModule.forFeature([
      {
        name: StoreDeliveryDriverMembershipModel.name,
        schema: StoreDeliveryDriverMembershipSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
    ]),
    SubscriptionsModule,
  ],
  controllers: [PlatformStoreDriverInvitesController],
  providers: [StoreDeliveryDriversService],
  exports: [StoreDeliveryDriversService],
})
export class StoreDeliveryDriversModule {}
