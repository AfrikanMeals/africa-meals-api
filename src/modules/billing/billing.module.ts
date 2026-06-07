import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { CartModule } from '@modules/cart/cart.module';
import { CouponsModule } from '@modules/coupons/coupons.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { PlatformFeesModule } from '@modules/platform-fees/platform-fees.module';
import { PlatformShippingSettingsModule } from '@modules/platform-shipping-settings/platform-shipping-settings.module';
import { StoreModule } from '@modules/store/store.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { UsersModule } from '@modules/users/users.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { VendorNotificationModule } from '@modules/vendor-notifications/vendor-notification.module';
import { Module, forwardRef } from '@nestjs/common';
import { StripeConnectTransferModule } from './stripe/stripe-connect-transfer.module';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PaymentMethodModel,
  PaymentMethodSchema,
} from '@schemas/payment-method.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import {
  AdCreditPaymentModel,
  AdCreditPaymentSchema,
} from '@schemas/ad-credit-payment.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaypalModule } from './paypal/paypal.module';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
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
    forwardRef(() => StoreModule),
    SubscriptionsModule,
    forwardRef(() => OrdersModule),
    StripeConnectTransferModule,
    PlatformFeesModule,
    PlatformShippingSettingsModule,
    SupportedCountriesModule,
    VendorStatusEmailModule,
    forwardRef(() => VendorNotificationModule),
    MongooseModule.forFeature([
      { name: PaymentMethodModel.name, schema: PaymentMethodSchema },
      { name: StoreModel.name, schema: StoreSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      {
        name: AdCreditPaymentModel.name,
        schema: AdCreditPaymentSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: AddressModel.name, schema: AddressSchema },
    ]),
  ],
  exports: [BillingService, StripeConnectService, StripeConnectTransferModule],
})
export class BillingModule {}
