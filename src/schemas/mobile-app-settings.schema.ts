import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Config version par plateforme (Android / iOS). */
@Schema({ _id: false })
export class AppPlatformVersionConfigModel {
  @Prop({ type: String, default: '' })
  versionNumber: string;

  @Prop({ type: String, default: '' })
  buildId: string;

  /** Legacy monolingue — miroir de FR||EN pour anciens clients. */
  @Prop({ type: String, default: '' })
  whatsNewHtml: string;

  @Prop({ type: String, default: '' })
  whatsNewHtmlFr: string;

  @Prop({ type: String, default: '' })
  whatsNewHtmlEn: string;

  @Prop({ type: Boolean, default: false })
  required: boolean;

  /** Date limite (YYYY-MM-DD) pour countdown soft update. */
  @Prop({ type: String, default: null })
  updateBefore: string | null;
}

export const AppPlatformVersionConfigSchema = SchemaFactory.createForClass(
  AppPlatformVersionConfigModel,
);

@Schema({ _id: false })
export class AppVersioningModel {
  @Prop({ type: AppPlatformVersionConfigSchema, default: () => ({}) })
  android: AppPlatformVersionConfigModel;

  @Prop({ type: AppPlatformVersionConfigSchema, default: () => ({}) })
  ios: AppPlatformVersionConfigModel;
}

export const AppVersioningSchema =
  SchemaFactory.createForClass(AppVersioningModel);

/** Paramètres globaux de l'app mobile (document singleton `key=default`). */
@Schema({ timestamps: true, collection: 'mobile_app_settings' })
export class MobileAppSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: '' })
  appStoreUrl: string;

  @Prop({ type: String, default: '' })
  playStoreUrl: string;

  @Prop({ type: String, default: '' })
  facebookUrl: string;

  @Prop({ type: String, default: '' })
  instagramUrl: string;

  @Prop({ type: String, default: '' })
  tiktokUrl: string;

  @Prop({ type: String, default: '' })
  xUrl: string;

  @Prop({ type: String, default: '' })
  youtubeUrl: string;

  @Prop({ type: String, default: '' })
  snapchatUrl: string;

  @Prop({ type: String, default: '' })
  linkedinUrl: string;

  @Prop({ type: String, default: '' })
  pinterestUrl: string;

  @Prop({ type: String, default: '' })
  contactEmail: string;

  @Prop({ type: String, default: '' })
  contactPhone: string;

  @Prop({ type: String, default: '' })
  mainEmail: string;

  @Prop({ type: String, default: '' })
  whatsappNumber: string;

  /** Force / soft update Android & iOS. */
  @Prop({ type: AppVersioningSchema, default: () => ({}) })
  appVersioning: AppVersioningModel;
}

export type MobileAppSettingsDocument =
  HydratedDocument<MobileAppSettingsModel>;

export const MobileAppSettingsSchema = SchemaFactory.createForClass(
  MobileAppSettingsModel,
);
