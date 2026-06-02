import { StripeConnectTransferModule } from '@modules/billing/stripe/stripe-connect-transfer.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PlatformFeesModule } from '@modules/platform-fees/platform-fees.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  RefundProcessingSettingsModel,
  RefundProcessingSettingsSchema,
} from '@schemas/refund-processing-settings.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { RefundProcessingCron } from './refund-processing.cron';
import { RefundProcessingService } from './refund-processing.service';
import { RefundsController } from './refunds.controller';
import { StripeRefundService } from './stripe-refund.service';

@Module({
  imports: [
    MailerModule,
    NotificationsModule,
    OrdersModule,
    PlatformFeesModule,
    StripeConnectTransferModule,
    VendorStatusEmailModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      {
        name: RefundProcessingSettingsModel.name,
        schema: RefundProcessingSettingsSchema,
      },
    ]),
  ],
  controllers: [RefundsController],
  providers: [
    RefundProcessingService,
    StripeRefundService,
    RefundProcessingCron,
  ],
  exports: [RefundProcessingService],
})
export class RefundsModule {}
