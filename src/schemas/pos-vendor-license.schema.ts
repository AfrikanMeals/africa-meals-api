import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { StoreModel } from './store.schema';

/** Forfait POS personnalisé pour un restaurant (override catalogue). */
@Schema({ timestamps: true, collection: 'pos_vendor_licenses' })
export class PosVendorLicenseModel {
  @Prop({ type: Types.ObjectId, ref: StoreModel.name, required: true, unique: true })
  store: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  priceMonthly: number;

  @Prop({ type: Number, required: true, min: 0 })
  priceYearly: number;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  @Prop({ type: Number, required: true, min: 1 })
  parentStationCount: number;

  @Prop({ type: Number, required: true, min: 0 })
  childStationsPerParent: number;

  @Prop({ type: String, trim: true, default: '' })
  note: string;

  @Prop({ type: Boolean, default: true })
  active: boolean;
}

export type PosVendorLicenseDocument = HydratedDocument<PosVendorLicenseModel>;

export const PosVendorLicenseSchema = SchemaFactory.createForClass(
  PosVendorLicenseModel,
);
