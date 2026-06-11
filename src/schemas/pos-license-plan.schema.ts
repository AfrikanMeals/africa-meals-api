import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Forfait licence Wise Eat POS (catalogue admin). */
@Schema({ timestamps: true, collection: 'pos_license_plans' })
export class PosLicensePlanModel {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, trim: true, default: '' })
  description: string;

  @Prop({ type: Number, required: true, min: 0 })
  priceMonthly: number;

  @Prop({ type: Number, required: true, min: 0 })
  priceYearly: number;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  /** Postes parent : appareil manager relié à la caisse (PC, tablette ou terminal). */
  @Prop({ type: Number, required: true, min: 1 })
  parentStationCount: number;

  /** Postes enfant par parent : téléphones ou tablettes serveur rattachés au poste manager. */
  @Prop({ type: Number, required: true, min: 0 })
  childStationsPerParent: number;

  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export type PosLicensePlanDocument = HydratedDocument<PosLicensePlanModel>;

export const PosLicensePlanSchema =
  SchemaFactory.createForClass(PosLicensePlanModel);
