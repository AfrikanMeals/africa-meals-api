import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Paramètres de tarification des pubs (singleton `key = default`).
 * Utilisé côté admin pour configurer le barème global.
 */
@Schema({ timestamps: true, collection: 'ad_pricing_settings' })
export class AdPricingSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  /** Coût facturé pour 1000 impressions (CPM). */
  @Prop({ type: Number, default: 0 })
  cpmCad: number;

  /** Coût facturé par clic (CPC). */
  @Prop({ type: Number, default: 0 })
  cpcCad: number;

  /** Coût campagne par 1000 impressions (CPM campagne). */
  @Prop({ type: Number, default: 0 })
  campaignCpmCad: number;

  /** Coût campagne par clic (CPC campagne). */
  @Prop({ type: Number, default: 0 })
  campaignCpcCad: number;

  /** Coût clic sur carte action de fin de campagne. */
  @Prop({ type: Number, default: 0 })
  campaignActionCad: number;

  /** Coût facturé par conversion (achat attribué pub/campagne). */
  @Prop({ type: Number, default: 0 })
  conversionCad: number;

  /** Budget minimum recommandé (affichage admin). */
  @Prop({ type: Number, default: 0 })
  minimumBudgetCad: number;
}

export type AdPricingSettingsDocument =
  HydratedDocument<AdPricingSettingsModel>;

export const AdPricingSettingsSchema = SchemaFactory.createForClass(
  AdPricingSettingsModel,
);
