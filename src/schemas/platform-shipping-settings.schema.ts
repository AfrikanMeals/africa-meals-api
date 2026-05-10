import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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
}

export type PlatformShippingSettingsDocument =
  HydratedDocument<PlatformShippingSettingsModel>;

export const PlatformShippingSettingsSchema = SchemaFactory.createForClass(
  PlatformShippingSettingsModel,
);
