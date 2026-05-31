import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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

  /** Liste de fonctionnalités affichées (une entrée = une puce). */
  @Prop({ type: [String], default: [] })
  features: string[];

  @Prop({ type: Boolean, default: true })
  active: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;

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

  /**
   * Nombre max d’éléments catalogue (plats + boissons) pour la boutique.
   * 0 = illimité.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  maxCatalogItems: number;
}

export type SubscriptionPlanDocument = HydratedDocument<SubscriptionPlanModel>;

export const SubscriptionPlanSchema = SchemaFactory.createForClass(
  SubscriptionPlanModel,
);
