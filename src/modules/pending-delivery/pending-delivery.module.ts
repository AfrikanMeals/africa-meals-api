import { MediasModule } from '@modules/medias/medias.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  PendingDeliveryProofModel,
  PendingDeliveryProofSchema,
} from '@schemas/pending-delivery-proof.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PendingDeliveryAutoCloseCron } from './pending-delivery-auto-close.cron';
import { PendingDeliveryService } from './pending-delivery.service';

@Module({
  imports: [
    MediasModule,
    MailerModule,
    NotificationsModule,
    VendorStatusEmailModule,
    TeamsModule,
    forwardRef(() => OrdersModule),
    MongooseModule.forFeature([
      {
        name: PendingDeliveryProofModel.name,
        schema: PendingDeliveryProofSchema,
      },
      { name: OrderModel.name, schema: OrderSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  providers: [PendingDeliveryService, PendingDeliveryAutoCloseCron],
  exports: [PendingDeliveryService],
})
export class PendingDeliveryModule {}
