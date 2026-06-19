import {
  PLATFORM_FEE_MODES,
  PlatformFeeMode,
} from '@schemas/platform-fees-settings.schema';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export { PLATFORM_FEE_MODES, PlatformFeeMode };

/**
 * Paramètres globaux de livraison (plateforme), distincts des zones par restaurant.
 * Document singleton : `key === 'default'`.
 */
@Schema({ timestamps: true, collection: 'platform_shipping_settings' })
export class PlatformShippingSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Montant ajouté par kilomètre (après application du forfait de tranche). */
  @Prop({ type: Number, default: 0 })
  perKmRate: number;

  /** Forfait de base ajouté aux frais distance (km × perKmRate). */
  @Prop({ type: Number, default: 0 })
  deliveryBasePrice: number;

  /** Distance maximale (km) : au-delà, livraison refusée côté plateforme. */
  @Prop({ type: Number, default: 25 })
  maxDeliveryRadiusKm: number;

  /** Devise des montants livraison (ISO 4217, alignée sur les régions actives). */
  @Prop({ type: String, default: 'CAD', uppercase: true, trim: true })
  currency: string;

  @Prop({
    type: [
      {
        minKm: { type: Number, required: true },
        maxKm: { type: Number, required: true },
        fee: { type: Number, required: true },
      },
    ],
    default: [],
  })
  ranges: { minKm: number; maxKm: number; fee: number }[];

  /** Frais prélevés par la plateforme sur le montant livraison facturé au client. */
  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'percent' })
  deliveryWithheldFeeMode: PlatformFeeMode;

  @Prop({ type: Number, default: 0 })
  deliveryWithheldFeeFixed: number;

  /** % du frais de livraison facturé (ex. 15 = 15 %). */
  @Prop({ type: Number, default: 0 })
  deliveryWithheldFeePercent: number;

  /** Pourboire livreur proposé au client (config admin ; intégration mobile séparée). */
  @Prop({ type: Boolean, default: false })
  deliveryTipEnabled: boolean;

  @Prop({ type: String, enum: PLATFORM_FEE_MODES, default: 'fixed' })
  deliveryTipMode: PlatformFeeMode;

  @Prop({ type: Number, default: 0 })
  deliveryTipFixed: number;

  /** % de la valeur commande (ex. 10 = 10 %). */
  @Prop({ type: Number, default: 0 })
  deliveryTipPercent: number;

  /** Options de pourboire proposées (montants $ ou % selon deliveryTipMode). @deprecated Utiliser deliveryTipFixedPresets / deliveryTipPercentPresets */
  @Prop({ type: [Number], default: [] })
  deliveryTipPresets: number[];

  /** Options montant fixe ($). */
  @Prop({ type: [Number], default: [] })
  deliveryTipFixedPresets: number[];

  /** Options pourcentage (% du sous-total livraison). */
  @Prop({ type: [Number], default: [] })
  deliveryTipPercentPresets: number[];
}

export type PlatformShippingSettingsDocument =
  HydratedDocument<PlatformShippingSettingsModel>;

export const PlatformShippingSettingsSchema = SchemaFactory.createForClass(
  PlatformShippingSettingsModel,
);
