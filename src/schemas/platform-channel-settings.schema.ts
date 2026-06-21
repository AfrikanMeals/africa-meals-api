import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

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

  @Prop({ type: String, default: null, trim: true, name: 'telegram_api_base_url' })
  telegramApiBaseUrl?: string | null;
}

export type PlatformChannelSettingsDocument =
  HydratedDocument<PlatformChannelSettingsModel>;

export const PlatformChannelSettingsSchema = SchemaFactory.createForClass(
  PlatformChannelSettingsModel,
);
