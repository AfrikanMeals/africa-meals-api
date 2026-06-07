import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { StoreModel } from './store.schema';
import {
  defaultVendorNotificationPreferences,
  type VendorNotificationPreferencesMap,
} from '@modules/vendor-notifications/vendor-notification.constants';

@Schema({
  timestamps: true,
  collection: 'vendor_notification_preferences',
})
export class VendorNotificationPreferencesModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    unique: true,
    index: true,
  })
  store: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.Mixed,
    default: () => defaultVendorNotificationPreferences(),
  })
  categories: VendorNotificationPreferencesMap;

  /** Bloqué tant qu'une facture SMS mensuelle n'est pas réglée. */
  @Prop({ type: Boolean, default: false, name: 'sms_billing_suspended' })
  smsBillingSuspended?: boolean;

  @Prop({ required: false, default: null, name: 'sms_billing_suspended_at' })
  smsBillingSuspendedAt?: Date | null;

  @Prop({ required: false, default: null, name: 'sms_billing_suspend_reason' })
  smsBillingSuspendReason?: string | null;
}

export const VendorNotificationPreferencesSchema = SchemaFactory.createForClass(
  VendorNotificationPreferencesModel,
);
