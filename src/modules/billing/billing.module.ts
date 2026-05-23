import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { CartModule } from '@modules/cart/cart.module';
import { CouponsModule } from '@modules/coupons/coupons.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PlatformFeesModule } from '@modules/platform-fees/platform-fees.module';
import { PlatformShippingSettingsModule } from '@modules/platform-shipping-settings/platform-shipping-settings.module';
import { StoreModule } from '@modules/store/store.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { UsersModule } from '@modules/users/users.module';
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PaymentMethodModel,
  PaymentMethodSchema,
} from '@schemas/payment-method.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaypalModule } from './paypal/paypal.module';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StripeConnectService as LegacyStripeConnectService } from './stripe-connect.service';
import { StripeConnectService } from './stripe/stripe-connect.service';
import { StripeConnectTransferService } from './stripe/stripe-connect-transfer.service';
import { StripeGroupedCheckoutService } from './stripe/stripe-grouped-checkout.service';
import { UserModel, UserSchema } from '@schemas/user.schema';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    LegacyStripeConnectService,
    StripeGroupedCheckoutService,
    StripeConnectService,
    StripeConnectTransferService,
  ],
  imports: [
    WsNotifyModule,
    PaypalModule,
    UsersModule,
    CartModule,
    CouponsModule,
    StoreModule,
    SubscriptionsModule,
    forwardRef(() => OrdersModule),
    PlatformFeesModule,
    PlatformShippingSettingsModule,
    MongooseModule.forFeature([
      { name: PaymentMethodModel.name, schema: PaymentMethodSchema },
      { name: StoreModel.name, schema: StoreSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
    ]),
  ],
  exports: [
    BillingService,
    LegacyStripeConnectService,
    StripeConnectService,
    StripeConnectTransferService,
  ],
})
export class BillingModule {}
