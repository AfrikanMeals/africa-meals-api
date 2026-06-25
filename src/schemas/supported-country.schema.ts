import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';
import {
  RegionAdDiffusionPricingModel,
  RegionAdDiffusionPricingSchema,
  RegionAdNotificationPricingModel,
  RegionAdNotificationPricingSchema,
  RegionVendorSmsPricingModel,
  RegionVendorSmsPricingSchema,
} from './region-pricing.schema';

/** Règle de taxe régionale (par pays). */
@Schema({ _id: false })
export class RegionTaxRuleModel {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({ required: true, enum: ['percent', 'fixed'], default: 'percent' })
  feeType: 'percent' | 'fixed';

  @Prop({ required: true, default: 0 })
  feeValue: number;

  /** Modules : order, payout, subscription, refund */
  @Prop({ type: [String], default: [] })
  modules: string[];
}

export const RegionTaxRuleSchema =
  SchemaFactory.createForClass(RegionTaxRuleModel);

@Schema({
  timestamps: true,
  collection: 'supported_countries',
})
export class SupportedCountryModel extends BaseSchema {
  @Prop({ required: true, unique: true, uppercase: true })
  code: string;

  @Prop({ required: true })
  name: string;

  /** Région ISO pour libphonenumber (ex. CA, SN, FR) */
  @Prop({ required: true })
  phoneRegion: string;

  /** Devise principale utilisée dans l’app pour ce pays (ISO 4217, ex. CAD, XOF). */
  @Prop({ required: true, uppercase: true, default: 'CAD' })
  currency: string;

  /**
   * Override Stripe : montants entiers sans ×100 (XAF, XOF…).
   * Si absent, dérivé automatiquement de la devise.
   */
  @Prop({ required: false, type: Boolean })
  stripeZeroDecimal?: boolean;

  @Prop({ default: true })
  active: boolean;

  /** Fuseau IANA pour menu du jour, horaires et rappels (ex. America/Toronto). */
  @Prop({ required: false, trim: true, type: String })
  timezone?: string;

  @Prop({ type: [RegionTaxRuleSchema], default: [] })
  taxes: RegionTaxRuleModel[];

  @Prop({
    type: RegionAdDiffusionPricingSchema,
    default: null,
    name: 'ad_diffusion_pricing',
  })
  adDiffusionPricing?: RegionAdDiffusionPricingModel | null;

  @Prop({
    type: RegionAdNotificationPricingSchema,
    default: null,
    name: 'ad_notification_pricing',
  })
  adNotificationPricing?: RegionAdNotificationPricingModel | null;

  @Prop({
    type: RegionVendorSmsPricingSchema,
    default: null,
    name: 'vendor_sms_pricing',
  })
  vendorSmsPricing?: RegionVendorSmsPricingModel | null;

  /**
   * Taux de change Ad Cash → devise régionale.
   * 1 Ad Cash = adCashToCurrencyRate unités de `currency`.
   */
  @Prop({ required: false, default: 1, min: 0.0001 })
  adCashToCurrencyRate?: number;
}

export const SupportedCountrySchema = SchemaFactory.createForClass(
  SupportedCountryModel,
);
