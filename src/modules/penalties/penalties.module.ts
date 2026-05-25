import { StripeConnectTransferModule } from '@modules/billing/stripe/stripe-connect-transfer.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  PenaltyTransferModel,
  PenaltyTransferSchema,
} from '@schemas/penalty-transfer.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesService } from './penalties.service';
import { StripePenaltyTransferService } from './stripe-penalty-transfer.service';

@Module({
  imports: [
    StripeConnectTransferModule,
    MongooseModule.forFeature([
      { name: PenaltyTransferModel.name, schema: PenaltyTransferSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [PenaltiesController],
  providers: [PenaltiesService, StripePenaltyTransferService],
  exports: [PenaltiesService, StripePenaltyTransferService],
})
export class PenaltiesModule {}
