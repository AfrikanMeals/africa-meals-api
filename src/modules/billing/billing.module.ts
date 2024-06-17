import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PaymentMethodModel,
  PaymentMethodSchema,
} from '@schemas/payment-method.schema';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaypalModule } from './paypal/paypal.module';

@Module({
  controllers: [BillingController],
  providers: [BillingService],
  imports: [
    PaypalModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: PaymentMethodModel.name, schema: PaymentMethodSchema },
    ]),
  ],
  exports: [BillingService],
})
export class BillingModule {}
