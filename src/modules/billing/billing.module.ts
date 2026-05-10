import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PaymentMethodModel,
  PaymentMethodSchema,
} from '@schemas/payment-method.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaypalModule } from './paypal/paypal.module';
import { StripeConnectService } from './stripe-connect.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, StripeConnectService],
  imports: [
    PaypalModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: PaymentMethodModel.name, schema: PaymentMethodSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  exports: [BillingService],
})
export class BillingModule {}
