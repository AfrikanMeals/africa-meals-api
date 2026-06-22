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

/** Offre d’abonnement vendeur (catalogue admin). */
@Schema({ timestamps: true, collection: 'subscription_plans' })
export class SubscriptionPlanModel {
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

  /**
   * Tarifs par région (ISO2). Si absent pour une région → repli sur priceMonthly / priceYearly / currency.
   */
  @Prop({
    type: [PlanRegionPricingSchema],
    default: [],
    name: 'pricing_by_region',
  })
  pricingByRegion: PlanRegionPricingModel[];

  /** Liste de fonctionnalités affichées (une entrée = une puce). */
  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  /**
   * Score de visibilité (0–100) pour recommandations et diffusion Ads.
   * Plus la valeur est élevée, plus les produits et pubs de la boutique sont favorisés.
   */
  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  recommendationScore: number;

  /** Nombre de jours d’essai gratuit (0 = pas d’essai). Interdit sur formule FREE. */
  @Prop({ type: Number, default: 0, min: 0 })
  trialDays: number;

  /** Rappels push : jours restants avant fin d’essai (ex. [7, 3, 1]). */
  @Prop({ type: [Number], default: [] })
  trialReminderDays: number[];

  /** Nombre max de boutiques créables par vendeur (0 = illimité). */
  @Prop({ type: Number, default: 0, min: 0 })
  maxStores: number;

  /** Active les options d’accès mobile liées à la formule. */
  @Prop({ type: Boolean, default: false })
  mobileAccess: boolean;

  /** Permet aux clients de s’abonner à la boutique (bouton S’abonner). */
  @Prop({ type: Boolean, default: false })
  storeSubscriptionEnabled: boolean;

  /** Autorise la pré-commande de repas pour les boutiques sur cette formule. */
  @Prop({ type: Boolean, default: false })
  mealPreOrderEnabled: boolean;

  /** Autorise le paiement à la collecte (pickup) pour les boutiques sur cette formule. */
  @Prop({ type: Boolean, default: false })
  pickupPayOnDeliveryEnabled: boolean;

  /** Autorise les outils marketing (coupons, campagnes pub, bannières). */
  @Prop({ type: Boolean, default: false })
  marketingToolsEnabled: boolean;

  /** Permet au vendeur de choisir son moteur de carte (sinon moteur par défaut plateforme). */
  @Prop({ type: Boolean, default: false })
  mapEngineSwitcherEnabled: boolean;

  /**
   * Livraison autonome obligatoire : le vendeur doit gérer sa flotte (agents boutique).
   * Hors pool plateforme. Si false, flotte optionnelle via fiche restaurant + pool plateforme.
   */
  @Prop({ type: Boolean, default: false })
  selfDeliveryEnabled: boolean;

  /**
   * Nombre max de livreurs assignables à une boutique (invitations actives + en attente).
   * 0 = illimité.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxDeliveryAgents: number;

  /**
   * Nombre max d’éléments catalogue (plats + boissons) pour la boutique.
   * 0 = illimité.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxCatalogItems: number;

  /**
   * Nombre max de plats configurables par jour dans le menu du jour.
   * 0 = illimité.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxDailyMenuItems: number;

  /**
   * Nombre max d'items (plats + boissons) par campagne publicitaire.
   * 0 = utilise la valeur globale par défaut (AD_CAMPAIGN_MAX_ITEMS).
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxAdCampaignItems: number;

  /**
   * Nombre max de bannières Ads actives simultanément par boutique.
   * 0 = illimité.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxActiveBanners: number;

  /**
   * Nombre max de campagnes Ads actives (non archivées) simultanément par boutique.
   * 0 = illimité.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxActiveCampaigns: number;

  /** Cadeau Ad Cash à la première souscription (unités Ad Cash, 0 = aucun). */
  @Prop({ type: Number, default: 0, min: 0 })
  initialAdCashGift: number;

  /** Cadeau Ad Cash à chaque renouvellement (unités Ad Cash, 0 = aucun). */
  @Prop({ type: Number, default: 0, min: 0 })
  renewalAdCashGift: number;

  /**
   * Commission plateforme sur commande par région (ISO2).
   * Si absent pour une région → repli sur le barème global `platform_fees_settings`.
   */
  @Prop({
    type: [PlanRegionOrderCommissionSchema],
    default: [],
    name: 'order_commissions_by_region',
  })
  orderCommissionsByRegion: PlanRegionOrderCommissionModel[];

  /**
   * Frais de versement vendeur (payout) par région (ISO2).
   * Si absent pour une région → repli sur le barème global `platform_fees_settings`.
   */
  @Prop({
    type: [PlanRegionOrderCommissionSchema],
    default: [],
    name: 'payout_fees_by_region',
  })
  payoutFeesByRegion: PlanRegionOrderCommissionModel[];
}

export type SubscriptionPlanDocument = HydratedDocument<SubscriptionPlanModel>;

export const SubscriptionPlanSchema = SchemaFactory.createForClass(
  SubscriptionPlanModel,
);
