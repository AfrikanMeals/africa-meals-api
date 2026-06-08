import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LoyaltySettingsModel,
  LoyaltySettingsSchema,
} from '@schemas/loyalty-settings.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { LoyaltyController } from './loyalty.controller';
import { PlatformPromoProgramController } from './platform-promo-program.controller';
import { LoyaltyService } from './loyalty.service';

@Module({
  controllers: [LoyaltyController, PlatformPromoProgramController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
  imports: [
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: LoyaltySettingsModel.name, schema: LoyaltySettingsSchema },
    ]),
  ],
})
export class LoyaltyModule {}
