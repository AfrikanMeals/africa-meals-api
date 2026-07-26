import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  PlanRegionOrderCommissionModel,
  PlanRegionOrderCommissionSchema,
} from './plan-region-order-commission.schema';
import {
  PlanRegionPricingModel,
  PlanRegionPricingSchema,
} from './plan-region-pricing.schema';

/**
 * Formule d’abonnement Partner (catalogue admin) — isolée des plans vendeur.
 * Commission affiliation = 3 axes régionaux ; payout fees = retenue Connect.
 */
@Schema({ timestamps: true, collection: 'partner_subscription_plans' })
export class PartnerSubscriptionPlanModel {
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

  @Prop({
    type: [PlanRegionPricingSchema],
    default: [],
    name: 'pricing_by_region',
  })
  pricingByRegion: PlanRegionPricingModel[];

  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  /** Jours d’essai gratuit (0 = pas d’essai). */
  @Prop({ type: Number, default: 0, min: 0 })
  trialDays: number;

  /** Rappels push : jours restants avant fin d’essai (ex. [7, 3, 1]). */
  @Prop({ type: [Number], default: [] })
  trialReminderDays: number[];

  /** Commission affiliation — commandes clients attribuées. */
  @Prop({
    type: [PlanRegionOrderCommissionSchema],
    default: [],
    name: 'customer_order_commissions_by_region',
  })
  customerOrderCommissionsByRegion: PlanRegionOrderCommissionModel[];

  /** Commission affiliation — ventes boutique attribuées. */
  @Prop({
    type: [PlanRegionOrderCommissionSchema],
    default: [],
    name: 'vendor_sales_commissions_by_region',
  })
  vendorSalesCommissionsByRegion: PlanRegionOrderCommissionModel[];

  /** Commission affiliation — gains livreur attribués. */
  @Prop({
    type: [PlanRegionOrderCommissionSchema],
    default: [],
    name: 'courier_gains_commissions_by_region',
  })
  courierGainsCommissionsByRegion: PlanRegionOrderCommissionModel[];

  /** Frais retenus Wise Eat sur payout Connect Partner. */
  @Prop({
    type: [PlanRegionOrderCommissionSchema],
    default: [],
    name: 'payout_fees_by_region',
  })
  payoutFeesByRegion: PlanRegionOrderCommissionModel[];
}

export type PartnerSubscriptionPlanDocument =
  HydratedDocument<PartnerSubscriptionPlanModel>;

export const PartnerSubscriptionPlanSchema = SchemaFactory.createForClass(
  PartnerSubscriptionPlanModel,
);
