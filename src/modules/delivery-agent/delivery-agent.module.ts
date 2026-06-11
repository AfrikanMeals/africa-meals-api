import { AuthModule } from '@modules/auth/auth.module';
import { BillingModule } from '@modules/billing/billing.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { PlatformShippingSettingsModule } from '@modules/platform-shipping-settings/platform-shipping-settings.module';
import { StoreDeliveryDriversModule } from '@modules/store-delivery-drivers/store-delivery-drivers.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DeliveryAgentController } from './delivery-agent.controller';
import { DeliveryAgentService } from './delivery-agent.service';

@Module({
  imports: [
    AuthModule,
    MailerModule,
    NotificationsModule,
    BillingModule,
    OrdersModule,
    PlatformShippingSettingsModule,
    StoreDeliveryDriversModule,
    MongooseModule.forFeature([
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [DeliveryAgentController],
  providers: [DeliveryAgentService],
  exports: [DeliveryAgentService],
})
export class DeliveryAgentModule {}
