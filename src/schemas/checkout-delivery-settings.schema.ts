import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Paramètres plateforme checkout livraison (singleton `key=default`).
 * Contrôle le masquage de l’option Livraison quand aucun coursier n’est assignable.
 */
@Schema({ timestamps: true, collection: 'checkout_delivery_settings' })
export class CheckoutDeliverySettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /**
   * Si true : checkout mobile masque Livraison quand la dispo livreur est `unavailable`.
   * Défaut false : Livraison reste proposée dès que `supportsShipping` + module livraison.
   */
  @Prop({ type: Boolean, default: false })
  hideDeliveryWhenNoCourierAvailable: boolean;
}

export type CheckoutDeliverySettingsDocument =
  HydratedDocument<CheckoutDeliverySettingsModel>;

export const CheckoutDeliverySettingsSchema = SchemaFactory.createForClass(
  CheckoutDeliverySettingsModel,
);
