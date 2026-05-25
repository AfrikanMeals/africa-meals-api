import { StripeConnectTransferModule } from '@modules/billing/stripe/stripe-connect-transfer.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  PenaltyCustomMotifModel,
  PenaltyCustomMotifSchema,
} from '@schemas/penalty-custom-motif.schema';
import {
  PenaltyTransferModel,
  PenaltyTransferSchema,
} from '@schemas/penalty-transfer.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesService } from './penalties.service';
import { PenaltyParticipantEmailService } from './penalty-participant-email.service';
import { StripePenaltyTransferService } from './stripe-penalty-transfer.service';

@Module({
  imports: [
    StripeConnectTransferModule,
    MailerModule,
    MongooseModule.forFeature([
      { name: PenaltyTransferModel.name, schema: PenaltyTransferSchema },
      { name: PenaltyCustomMotifModel.name, schema: PenaltyCustomMotifSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [PenaltiesController],
  providers: [
    PenaltiesService,
    StripePenaltyTransferService,
    PenaltyParticipantEmailService,
  ],
  exports: [PenaltiesService, StripePenaltyTransferService],
})
export class PenaltiesModule {}
