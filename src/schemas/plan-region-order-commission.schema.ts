import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PLATFORM_FEE_MODES, PlatformFeeMode } from '@schemas/platform-fees-settings.schema';

/** Commission plateforme sur commande — barème par région pour une formule vendeur. */
@Schema({ _id: false })
export class PlanRegionOrderCommissionModel {
  @Prop({ type: String, required: true, trim: true, uppercase: true })
  regionCode: string;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'percent' })
  mode: PlatformFeeMode;

  /** Montant fixe dans la devise de la région (si mode = fixed). */
  @Prop({ type: Number, default: 0, min: 0 })
  fixed: number;

  /** Pourcentage du montant commande (si mode = percent). */
  @Prop({ type: Number, default: 0, min: 0 })
  percent: number;
}

export const PlanRegionOrderCommissionSchema = SchemaFactory.createForClass(
  PlanRegionOrderCommissionModel,
);
