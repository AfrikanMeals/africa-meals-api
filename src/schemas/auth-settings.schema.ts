import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Paramètres OAuth par plateforme, document singleton `key=default`. */
@Schema({ timestamps: true, collection: 'auth_settings' })
export class AuthSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** @deprecated Utiliser googleEnabledAdmin / googleEnabledMobile */
  @Prop({ type: Boolean, default: true })
  googleEnabled: boolean;

  /** @deprecated Utiliser appleEnabledAdmin / appleEnabledMobile */
  @Prop({ type: Boolean, default: true })
  appleEnabled: boolean;

  /** @deprecated Utiliser facebookEnabledAdmin / facebookEnabledMobile */
  @Prop({ type: Boolean, default: true })
  facebookEnabled: boolean;

  @Prop({ type: Boolean, default: true })
  googleEnabledAdmin: boolean;

  @Prop({ type: Boolean, default: true })
  googleEnabledMobile: boolean;

  @Prop({ type: Boolean, default: true })
  appleEnabledAdmin: boolean;

  @Prop({ type: Boolean, default: true })
  appleEnabledMobile: boolean;

  @Prop({ type: Boolean, default: true })
  facebookEnabledAdmin: boolean;

  @Prop({ type: Boolean, default: true })
  facebookEnabledMobile: boolean;

  /** E-mail de sécurité à chaque connexion sur le tableau de bord admin. */
  @Prop({ type: Boolean, default: true })
  loginEmailNotifyAdminEnabled: boolean;

  /** E-mail de sécurité à chaque connexion sur l’application mobile. */
  @Prop({ type: Boolean, default: true })
  loginEmailNotifyMobileEnabled: boolean;
}

export type AuthSettingsDocument = HydratedDocument<AuthSettingsModel>;

export const AuthSettingsSchema = SchemaFactory.createForClass(AuthSettingsModel);

export type OAuthProviderKey = 'google' | 'apple' | 'facebook';
export type AuthOAuthPlatform = 'admin' | 'mobile';

export type AuthOAuthPlatformFlags = {
  googleEnabled: boolean;
  appleEnabled: boolean;
  facebookEnabled: boolean;
};
