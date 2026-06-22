import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  StoreAdCashLedgerModel,
  StoreAdCashLedgerSchema,
} from '@schemas/store-ad-cash.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { StoreAdCashGrantService } from './store-ad-cash-grant.service';

/** Crédits Ad Cash ledger — sans dépendance Teams / Ads / Subscriptions. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StoreAdCashLedgerModel.name, schema: StoreAdCashLedgerSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  providers: [StoreAdCashGrantService],
  exports: [StoreAdCashGrantService],
})
export class StoreAdCashModule {}
