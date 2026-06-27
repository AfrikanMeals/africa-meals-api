import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  PLATFORM_FEE_MODES,
  PlatformFeeMode,
} from '@schemas/platform-fees-settings.schema';
import {
  COMMISSION_TIER_BASIS,
  CommissionTierBasis,
  PlanRegionOrderCommissionTierModel,
  PlanRegionOrderCommissionTierSchema,
} from '@schemas/plan-region-order-commission-tier.schema';

/** Commission plateforme sur commande — barème par région pour une formule vendeur. */
@Schema({ _id: false })
export class PlanRegionOrderCommissionModel {
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  regionCode: string;

  @Prop({ type: String, enum: COMMISSION_TIER_BASIS, default: 'unit_price' })
  tierBasis: CommissionTierBasis;

  @Prop({
    type: [PlanRegionOrderCommissionTierSchema],
    default: [],
  })
  tiers: PlanRegionOrderCommissionTierModel[];

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'percent' })
  fallbackMode: PlatformFeeMode;

  @Prop({ type: Number, default: 0, min: 0 })
  fallbackFixed: number;

  @Prop({ type: Number, default: 0, min: 0 })
  fallbackPercent: number;

  /** Legacy — synchronisé avec fallback si tiers vides. */
  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'percent' })
  mode: PlatformFeeMode;

  @Prop({ type: Number, default: 0, min: 0 })
  fixed: number;

  @Prop({ type: Number, default: 0, min: 0 })
  percent: number;
}

export const PlanRegionOrderCommissionSchema = SchemaFactory.createForClass(
  PlanRegionOrderCommissionModel,
);
