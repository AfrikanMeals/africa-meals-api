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

  /** Distance maximale (km) : au-delà, livraison refusée côté plateforme. */
  @Prop({ type: Number, default: 25 })
  maxDeliveryRadiusKm: number;

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
}

export type PlatformShippingSettingsDocument =
  HydratedDocument<PlatformShippingSettingsModel>;

export const PlatformShippingSettingsSchema = SchemaFactory.createForClass(
  PlatformShippingSettingsModel,
);
