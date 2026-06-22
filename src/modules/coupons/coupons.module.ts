import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  StoreCouponModel,
  StoreCouponSchema,
} from '@schemas/store_coupon.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StoreCouponModel.name, schema: StoreCouponSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
    SubscriptionsModule,
  ],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
