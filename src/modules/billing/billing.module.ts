import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { CartModule } from '@modules/cart/cart.module';
import { CouponsModule } from '@modules/coupons/coupons.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PlatformShippingSettingsModule } from '@modules/platform-shipping-settings/platform-shipping-settings.module';
import { StoreModule } from '@modules/store/store.module';
import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
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
import { StripeConnectService } from './stripe/stripe-connect.service';
import { StripeGroupedCheckoutService } from './stripe/stripe-grouped-checkout.service';
import { UserModel, UserSchema } from '@schemas/user.schema';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    StripeGroupedCheckoutService,
    StripeConnectService,
  ],
  imports: [
    WsNotifyModule,
    PaypalModule,
    UsersModule,
    CartModule,
    CouponsModule,
    StoreModule,
    OrdersModule,
    PlatformShippingSettingsModule,
    MongooseModule.forFeature([
      { name: PaymentMethodModel.name, schema: PaymentMethodSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  exports: [BillingService, StripeConnectService],
})
export class BillingModule {}
