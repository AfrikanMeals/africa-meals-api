import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Politique régionale plateforme (singleton key=default).
 * Indépendant des lignes `supported_countries` (actifs = marchés ouverts).
 */
@Schema({
  collection: 'platform_region_settings',
  timestamps: true,
})
export class PlatformRegionSettingsModel {
  @Prop({ required: true, unique: true, default: 'default' })
  key!: string;

  /**
   * Gate mobile Region Check.
   * true (défaut) = bloquer si pays détecté hors régions actives.
   * false = laisser entrer l’app sans vérifier le pays.
   */
  @Prop({ default: true })
  mobileRegionCheckEnabled!: boolean;
}

export type PlatformRegionSettingsDocument = PlatformRegionSettingsModel &
  Document;

export const PlatformRegionSettingsSchema = SchemaFactory.createForClass(
  PlatformRegionSettingsModel,
);
