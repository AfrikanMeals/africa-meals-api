import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  PlatformSmtpConfigModel,
  PlatformSmtpConfigSchema,
} from './platform-smtp-config.schema';

/** Credentials Bird WhatsApp (singleton `key=default`). Les champs vides → fallback .env. */
@Schema({ timestamps: true, collection: 'platform_channel_settings' })
export class PlatformChannelSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: null, trim: true, name: 'bird_whatsapp_workspace_id' })
  birdWhatsappWorkspaceId?: string | null;

  @Prop({ type: String, default: null, trim: true, name: 'bird_whatsapp_channel_id' })
  birdWhatsappChannelId?: string | null;

  @Prop({ type: String, default: null, trim: true, name: 'bird_api_base_url' })
  birdApiBaseUrl?: string | null;

  @Prop({ type: String, default: null, trim: true, name: 'bird_email_workspace_id' })
  birdEmailWorkspaceId?: string | null;

  @Prop({ type: String, default: null, trim: true, name: 'bird_email_channel_id' })
  birdEmailChannelId?: string | null;

  @Prop({ type: String, default: null, trim: true, name: 'telegram_api_base_url' })
  telegramApiBaseUrl?: string | null;

  @Prop({ type: String, default: 'auto', trim: true, name: 'email_engine' })
  emailEngine?: string;

  @Prop({ type: [PlatformSmtpConfigSchema], default: [], name: 'smtp_configs' })
  smtpConfigs?: PlatformSmtpConfigModel[];

  @Prop({
    type: Map,
    of: String,
    default: () => ({}),
    name: 'email_module_engines',
  })
  emailModuleEngines?: Map<string, string>;
}

export type PlatformChannelSettingsDocument =
  HydratedDocument<PlatformChannelSettingsModel>;

export const PlatformChannelSettingsSchema = SchemaFactory.createForClass(
  PlatformChannelSettingsModel,
);
