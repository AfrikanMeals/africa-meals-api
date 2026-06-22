import { BaseSchema } from '@schemas/base.schema';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum StoreAdCashLedgerTypeEnum {
  GRANT = 'GRANT',
  REDEMPTION = 'REDEMPTION',
}

@Schema({ collection: 'store-ad-cash-ledger', timestamps: true })
export class StoreAdCashLedgerModel extends BaseSchema {
  @Prop({ type: Types.ObjectId, ref: 'StoreModel', required: true, index: true })
  store: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: true, index: true })
  owner: Types.ObjectId;

  @Prop({
    required: true,
    enum: StoreAdCashLedgerTypeEnum,
  })
  type: StoreAdCashLedgerTypeEnum;

  /** Unités Ad Cash (positif). */
  @Prop({ required: true, min: 0 })
  adCashAmount: number;

  /** Équivalent devise au moment de l'opération. */
  @Prop({ required: true, min: 0 })
  currencyEquivalent: number;

  /** 1 Ad Cash = exchangeRate unités de currency. */
  @Prop({ required: true, min: 0.0001 })
  exchangeRate: number;

  @Prop({ required: true, default: 'CAD' })
  currency: string;

  @Prop({ type: Types.ObjectId, ref: 'UserModel', required: false, default: null })
  grantedBy?: Types.ObjectId | null;

  @Prop({ required: false, trim: true, default: null })
  note?: string | null;
}

export const StoreAdCashLedgerSchema =
  SchemaFactory.createForClass(StoreAdCashLedgerModel);

StoreAdCashLedgerSchema.index({ store: 1, type: 1, createdAt: -1 });
