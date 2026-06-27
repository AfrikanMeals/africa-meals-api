import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  PLATFORM_FEE_MODES,
  PlatformFeeMode,
} from '@schemas/platform-fees-settings.schema';

export const COMMISSION_TIER_BASIS = ['unit_price', 'order_subtotal'] as const;
export type CommissionTierBasis = (typeof COMMISSION_TIER_BASIS)[number];

/** Tranche de barème commission (montants en unités affichées de la devise région). */
@Schema({ _id: false })
export class PlanRegionOrderCommissionTierModel {
  @Prop({ type: Number, required: true, min: 0 })
  minPrice: number;

  /** Limite supérieure exclusive ; absent = pas de limite. */
  @Prop({ type: Number, min: 0 })
  maxPrice?: number;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'percent' })
  mode: PlatformFeeMode;

  /** Montant fixe (par unité si tierBasis = unit_price). */
  @Prop({ type: Number, default: 0, min: 0 })
  fixed: number;

  @Prop({ type: Number, default: 0, min: 0 })
  percent: number;
}

export const PlanRegionOrderCommissionTierSchema = SchemaFactory.createForClass(
  PlanRegionOrderCommissionTierModel,
);
