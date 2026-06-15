import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Paramètres de sécurité globaux (singleton `key=default`), pilotés depuis l’admin. */
@Schema({ timestamps: true, collection: 'security_settings' })
export class SecuritySettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  /** @deprecated Utiliser les drapeaux par plateforme. Conservé pour migration. */
  @Prop({ type: Boolean, default: false })
  appCheckEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  appCheckMobileEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  appCheckWebEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  appCheckAdminEnabled: boolean;

  @Prop({ type: Boolean, default: false })
  appCheckWebsocketEnabled: boolean;

  /** Active la vérification des jetons sur l’API REST principale. */
  @Prop({ type: Boolean, default: false })
  appCheckApiEnabled: boolean;
}

export type SecuritySettingsDocument =
  HydratedDocument<SecuritySettingsModel>;

export const SecuritySettingsSchema =
  SchemaFactory.createForClass(SecuritySettingsModel);
