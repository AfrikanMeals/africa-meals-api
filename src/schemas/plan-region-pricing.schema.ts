import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Tarifs d’abonnement vendeur par région (ISO2). */
@Schema({ _id: false })
export class PlanRegionPricingModel {
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  regionCode: string;

  @Prop({ type: Number, required: true, min: 0 })
  priceMonthly: number;

  @Prop({ type: Number, required: true, min: 0 })
  priceYearly: number;

  @Prop({ type: String, default: 'CAD', trim: true, uppercase: true })
  currency: string;
}

export const PlanRegionPricingSchema = SchemaFactory.createForClass(
  PlanRegionPricingModel,
);
