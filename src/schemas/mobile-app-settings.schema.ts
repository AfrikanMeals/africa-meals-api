import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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
}

export type MobileAppSettingsDocument =
  HydratedDocument<MobileAppSettingsModel>;

export const MobileAppSettingsSchema = SchemaFactory.createForClass(
  MobileAppSettingsModel,
);
