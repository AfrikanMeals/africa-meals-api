import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Branding & fonds d'écran mobile (singleton `key=default`). */
@Schema({ timestamps: true, collection: 'platform_theme_settings' })
export class PlatformThemeSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** Fond des 5 onglets client (mode clair). */
  @Prop({ type: String, default: '' })
  mobileTabBackgroundLightUrl: string;

  /** Fond des 5 onglets client (mode sombre). */
  @Prop({ type: String, default: '' })
  mobileTabBackgroundDarkUrl: string;

  /** Logo app mobile, e-mails, événements marketing. */
  @Prop({ type: String, default: '' })
  appLogoUrl: string;

  /** Logo admin web (sidebar, auth, factures). */
  @Prop({ type: String, default: '' })
  adminLogoUrl: string;
}

export type PlatformThemeSettingsDocument =
  HydratedDocument<PlatformThemeSettingsModel>;

export const PlatformThemeSettingsSchema = SchemaFactory.createForClass(
  PlatformThemeSettingsModel,
);
