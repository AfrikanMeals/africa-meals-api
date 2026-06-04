import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Paramètres OAuth globaux (admin + app mobile), document singleton `key=default`. */
@Schema({ timestamps: true, collection: 'auth_settings' })
export class AuthSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: true })
  googleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  appleEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  facebookEnabled: boolean;
}

export type AuthSettingsDocument = HydratedDocument<AuthSettingsModel>;

export const AuthSettingsSchema = SchemaFactory.createForClass(AuthSettingsModel);

export type OAuthProviderKey = 'google' | 'apple' | 'facebook';
