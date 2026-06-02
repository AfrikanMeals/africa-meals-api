import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AdNotificationChannelsModel,
  AdNotificationChannelsSchema,
} from '@schemas/ad-notification-addon.schema';
import { HydratedDocument } from 'mongoose';

/**
 * Barème facturation des notifications Ads (singleton `key = default`).
 * Par canal : livraison, interaction (ouverture/clic), conversion.
 */
@Schema({ timestamps: true, collection: 'ad_notification_pricing_settings' })
export class AdNotificationPricingSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  /** Canaux proposés aux boutiques (admin — Paramètres notifications). */
  @Prop({
    type: AdNotificationChannelsSchema,
    default: () => ({
      email: true,
      push: true,
      inApp: true,
      sms: true,
      whatsapp: true,
    }),
    name: 'available_channels',
  })
  availableChannels: AdNotificationChannelsModel;

  @Prop({ type: Number, default: 0, name: 'email_delivery_cad' })
  emailDeliveryCad: number;

  @Prop({ type: Number, default: 0, name: 'email_interaction_cad' })
  emailInteractionCad: number;

  @Prop({ type: Number, default: 0, name: 'email_conversion_cad' })
  emailConversionCad: number;

  @Prop({ type: Number, default: 0, name: 'push_delivery_cad' })
  pushDeliveryCad: number;

  @Prop({ type: Number, default: 0, name: 'push_interaction_cad' })
  pushInteractionCad: number;

  @Prop({ type: Number, default: 0, name: 'push_conversion_cad' })
  pushConversionCad: number;

  @Prop({ type: Number, default: 0, name: 'in_app_delivery_cad' })
  inAppDeliveryCad: number;

  @Prop({ type: Number, default: 0, name: 'in_app_interaction_cad' })
  inAppInteractionCad: number;

  @Prop({ type: Number, default: 0, name: 'in_app_conversion_cad' })
  inAppConversionCad: number;

  @Prop({ type: Number, default: 0, name: 'sms_delivery_cad' })
  smsDeliveryCad: number;

  @Prop({ type: Number, default: 0, name: 'sms_interaction_cad' })
  smsInteractionCad: number;

  @Prop({ type: Number, default: 0, name: 'sms_conversion_cad' })
  smsConversionCad: number;

  @Prop({ type: Number, default: 0, name: 'whatsapp_delivery_cad' })
  whatsappDeliveryCad: number;

  @Prop({ type: Number, default: 0, name: 'whatsapp_interaction_cad' })
  whatsappInteractionCad: number;

  @Prop({ type: Number, default: 0, name: 'whatsapp_conversion_cad' })
  whatsappConversionCad: number;
}

export type AdNotificationPricingSettingsDocument =
  HydratedDocument<AdNotificationPricingSettingsModel>;

export const AdNotificationPricingSettingsSchema = SchemaFactory.createForClass(
  AdNotificationPricingSettingsModel,
);
