import { PlatformFeesModule } from '@modules/platform-fees/platform-fees.module';
import { PlatformShippingSettingsModule } from '@modules/platform-shipping-settings/platform-shipping-settings.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { StripeChargeFeeService } from './stripe-charge-fee.service';
import { StripeConnectTransferService } from './stripe-connect-transfer.service';

/** Transferts Connect (vendeur / livreur) sans dépendre de OrdersModule ni StoreModule. */
@Module({
  imports: [
    PlatformFeesModule,
    PlatformShippingSettingsModule,
    SubscriptionsModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  providers: [StripeChargeFeeService, StripeConnectTransferService],
  exports: [StripeChargeFeeService, StripeConnectTransferService],
})
export class StripeConnectTransferModule {}
