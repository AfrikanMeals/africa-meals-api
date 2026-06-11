import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { VendorNotificationBillingCyclePeriodEnum } from '@modules/vendor-notifications/vendor-notification-billing-period.util';

/** Barème SMS notifications vendeur (singleton `key = default`). */
@Schema({
  timestamps: true,
  collection: 'vendor_notification_pricing_settings',
})
export class VendorNotificationPricingSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: String, default: 'CAD', trim: true })
  currency: string;

  /** Coût facturé par SMS envoyé (notifications vendeur). */
  @Prop({ type: Number, default: 0.08, name: 'sms_unit_cost_cad' })
  smsUnitCostCad: number;

  @Prop({ type: Boolean, default: true, name: 'sms_enabled' })
  smsEnabled: boolean;

  /** Période de clôture des factures SMS (DAILY, WEEKLY, MONTHLY). */
  @Prop({
    type: String,
    enum: VendorNotificationBillingCyclePeriodEnum,
    default: VendorNotificationBillingCyclePeriodEnum.MONTHLY,
    name: 'billing_cycle_period',
  })
  billingCyclePeriod: VendorNotificationBillingCyclePeriodEnum;
}

export const VendorNotificationPricingSettingsSchema =
  SchemaFactory.createForClass(VendorNotificationPricingSettingsModel);
