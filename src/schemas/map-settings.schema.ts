import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Disponibilité des moteurs carte (admin vendeur + app mobile). */
@Schema({ timestamps: true, collection: 'map_settings' })
export class MapSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Tableau de bord admin — comptes vendeur. */
  @Prop({ type: Boolean, default: true })
  vendorMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  vendorGoogleEnabled: boolean;

  /** App mobile — mode client (USER). */
  @Prop({ type: Boolean, default: true })
  mobileUserMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileUserGoogleEnabled: boolean;

  /** App mobile — mode livreur (DELIVERY). */
  @Prop({ type: Boolean, default: true })
  mobileDeliveryMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileDeliveryGoogleEnabled: boolean;
}

export type MapSettingsDocument = HydratedDocument<MapSettingsModel>;

export const MapSettingsSchema =
  SchemaFactory.createForClass(MapSettingsModel);
