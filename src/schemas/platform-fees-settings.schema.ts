import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const PLATFORM_FEE_MODES = ['fixed', 'percent'] as const;
export type PlatformFeeMode = (typeof PLATFORM_FEE_MODES)[number];

/**
 * Barème global des frais plateforme (singleton `key === 'default'`).
 */
@Schema({ timestamps: true, collection: 'platform_fees_settings' })
export class PlatformFeesSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'fixed' })
  refundFeeMode: PlatformFeeMode;

  /** Frais de remboursement : montant fixe par remboursement. */
  @Prop({ type: Number, default: 0 })
  refundFeeFixed: number;

  /** Frais de remboursement : % du montant remboursé (ex. 2.5 = 2,5 %). */
  @Prop({ type: Number, default: 0 })
  refundFeePercent: number;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'fixed' })
  orderPaymentFeeMode: PlatformFeeMode;

  /** Frais de transaction paiement commande : fixe par paiement. */
  @Prop({ type: Number, default: 0 })
  orderPaymentFeeFixed: number;

  /** Frais de transaction paiement commande : % du montant payé. */
  @Prop({ type: Number, default: 0 })
  orderPaymentFeePercent: number;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'percent' })
  mlmCommissionMode: PlatformFeeMode;

  /** Commission MLM fixe par commande. */
  @Prop({ type: Number, default: 0 })
  mlmCommissionFixed: number;

  /** Commission MLM : % du sous-total commande alloué au réseau. */
  @Prop({ type: Number, default: 0 })
  mlmCommissionPercent: number;

  /** Plafond commission MLM par commande (0 = illimité). */
  @Prop({ type: Number, default: 0 })
  mlmCommissionCapPerOrder: number;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'fixed' })
  platformOrderFeeMode: PlatformFeeMode;

  /** Commission / frais de service plateforme sur commande : fixe. */
  @Prop({ type: Number, default: 0 })
  platformOrderFeeFixed: number;

  /** Commission plateforme sur commande : % du montant commande (hors livraison). */
  @Prop({ type: Number, default: 0 })
  platformOrderFeePercent: number;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'fixed' })
  payoutFeeMode: PlatformFeeMode;

  /** Frais de versement vendeur (payout) : montant fixe. */
  @Prop({ type: Number, default: 0 })
  payoutFeeFixed: number;

  /** Frais de versement vendeur (payout) : % du montant demandé. */
  @Prop({ type: Number, default: 0 })
  payoutFeePercent: number;
}

export type PlatformFeesSettingsDocument =
  HydratedDocument<PlatformFeesSettingsModel>;

export const PlatformFeesSettingsSchema = SchemaFactory.createForClass(
  PlatformFeesSettingsModel,
);
