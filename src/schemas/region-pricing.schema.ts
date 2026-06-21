import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AdNotificationChannelsModel,
  AdNotificationChannelsSchema,
} from '@schemas/ad-notification-addon.schema';
import { VendorNotificationBillingCyclePeriodEnum } from '@modules/vendor-notifications/vendor-notification-billing-period.util';

/** Barème diffusion Ads (CPM/CPC) scoped par région. */
@Schema({ _id: false })
export class RegionAdDiffusionPricingModel {
  @Prop({ type: Number, default: 0, name: 'cpm' })
  cpm: number;

  @Prop({ type: Number, default: 0, name: 'cpc' })
  cpc: number;

  @Prop({ type: Number, default: 0, name: 'campaign_cpm' })
  campaignCpm: number;

  @Prop({ type: Number, default: 0, name: 'campaign_cpc' })
  campaignCpc: number;

  @Prop({ type: Number, default: 0, name: 'campaign_action' })
  campaignAction: number;

  @Prop({ type: Number, default: 0, name: 'conversion' })
  conversion: number;

  @Prop({ type: Number, default: 0, name: 'minimum_budget' })
  minimumBudget: number;
}

export const RegionAdDiffusionPricingSchema = SchemaFactory.createForClass(
  RegionAdDiffusionPricingModel,
);

/** Barème notifications Ads scoped par région. */
@Schema({ _id: false })
export class RegionAdNotificationPricingModel {
  @Prop({
    type: AdNotificationChannelsSchema,
    default: null,
    name: 'available_channels',
  })
  availableChannels?: AdNotificationChannelsModel | null;

  @Prop({ type: Number, default: null, name: 'email_delivery' })
  emailDelivery?: number | null;

  @Prop({ type: Number, default: null, name: 'email_interaction' })
  emailInteraction?: number | null;

  @Prop({ type: Number, default: null, name: 'email_conversion' })
  emailConversion?: number | null;

  @Prop({ type: Number, default: null, name: 'push_delivery' })
  pushDelivery?: number | null;

  @Prop({ type: Number, default: null, name: 'push_interaction' })
  pushInteraction?: number | null;

  @Prop({ type: Number, default: null, name: 'push_conversion' })
  pushConversion?: number | null;

  @Prop({ type: Number, default: null, name: 'in_app_delivery' })
  inAppDelivery?: number | null;

  @Prop({ type: Number, default: null, name: 'in_app_interaction' })
  inAppInteraction?: number | null;

  @Prop({ type: Number, default: null, name: 'in_app_conversion' })
  inAppConversion?: number | null;

  @Prop({ type: Number, default: null, name: 'sms_delivery' })
  smsDelivery?: number | null;

  @Prop({ type: Number, default: null, name: 'sms_interaction' })
  smsInteraction?: number | null;

  @Prop({ type: Number, default: null, name: 'sms_conversion' })
  smsConversion?: number | null;

  @Prop({ type: Number, default: null, name: 'whatsapp_delivery' })
  whatsappDelivery?: number | null;

  @Prop({ type: Number, default: null, name: 'whatsapp_interaction' })
  whatsappInteraction?: number | null;

  @Prop({ type: Number, default: null, name: 'whatsapp_conversion' })
  whatsappConversion?: number | null;
}

export const RegionAdNotificationPricingSchema = SchemaFactory.createForClass(
  RegionAdNotificationPricingModel,
);

/** Barème SMS notifications vendeur scoped par région. */
@Schema({ _id: false })
export class RegionVendorSmsPricingModel {
  @Prop({ type: Number, default: null, name: 'sms_unit_cost' })
  smsUnitCost?: number | null;

  @Prop({ type: Boolean, default: null, name: 'sms_enabled' })
  smsEnabled?: boolean | null;

  @Prop({
    type: String,
    enum: VendorNotificationBillingCyclePeriodEnum,
    default: null,
    name: 'billing_cycle_period',
  })
  billingCyclePeriod?: VendorNotificationBillingCyclePeriodEnum | null;
}

export const RegionVendorSmsPricingSchema = SchemaFactory.createForClass(
  RegionVendorSmsPricingModel,
);
