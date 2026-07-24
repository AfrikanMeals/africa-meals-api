import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CheckoutDeliverySettingsModel,
  CheckoutDeliverySettingsSchema,
} from '@schemas/checkout-delivery-settings.schema';
import { CheckoutDeliverySettingsController } from './checkout-delivery-settings.controller';
import { CheckoutDeliverySettingsService } from './checkout-delivery-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: CheckoutDeliverySettingsModel.name,
        schema: CheckoutDeliverySettingsSchema,
      },
    ]),
  ],
  controllers: [CheckoutDeliverySettingsController],
  providers: [CheckoutDeliverySettingsService],
  exports: [CheckoutDeliverySettingsService],
})
export class CheckoutDeliverySettingsModule {}
