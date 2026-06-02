import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
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
}

export type AdNotificationPricingSettingsDocument =
  HydratedDocument<AdNotificationPricingSettingsModel>;

export const AdNotificationPricingSettingsSchema = SchemaFactory.createForClass(
  AdNotificationPricingSettingsModel,
);
