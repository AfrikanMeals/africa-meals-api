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

  @Prop({ type: Boolean, default: false })
  vendorGoogleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  vendorOsmEnabled: boolean;

  /** Moteur par défaut — tableau de bord vendeur (mapbox | google). */
  @Prop({ type: String, default: 'mapbox', trim: true })
  vendorDefaultMapEngine: string;

  /** App mobile — mode client (USER). */
  @Prop({ type: Boolean, default: true })
  mobileUserMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileUserGoogleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileUserOsmEnabled: boolean;

  /** Moteur par défaut — app mobile client (mapbox | google | osm). */
  @Prop({ type: String, default: 'mapbox', trim: true })
  mobileUserDefaultMapEngine: string;

  /** App mobile — mode livreur (DELIVERY). */
  @Prop({ type: Boolean, default: true })
  mobileDeliveryMapboxEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileDeliveryGoogleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  mobileDeliveryOsmEnabled: boolean;

  /** Moteur par défaut — app mobile livreur (mapbox | google | osm). */
  @Prop({ type: String, default: 'mapbox', trim: true })
  mobileDeliveryDefaultMapEngine: string;
}

export type MapSettingsDocument = HydratedDocument<MapSettingsModel>;

export const MapSettingsSchema =
  SchemaFactory.createForClass(MapSettingsModel);
