import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  PlatformMaintenanceEntryModel,
  PlatformMaintenanceEntrySchema,
} from './platform-maintenance.schema';

export { MaintenancePlatformEnum } from './platform-maintenance.schema';
export type { PlatformMaintenanceEntryModel } from './platform-maintenance.schema';

export enum SmsEngineEnum {
  BIRD = 'bird',
  TWILIO = 'twilio',
}

@Schema({ _id: false })
export class MaintenanceAlertStateEntry {
  @Prop({ type: String, required: true })
  status: string;

  @Prop({ type: Date, default: null })
  alertedAt?: Date | null;

  @Prop({ type: Date, default: null })
  recoveredAt?: Date | null;
}

export const MaintenanceAlertStateEntrySchema = SchemaFactory.createForClass(
  MaintenanceAlertStateEntry,
);

/** Paramètres alertes infra + moteur SMS global (singleton `key=default`). */
@Schema({ timestamps: true, collection: 'maintenance_alert_settings' })
export class MaintenanceAlertSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: false, name: 'alerts_enabled' })
  alertsEnabled: boolean;

  @Prop({ type: [String], default: [], name: 'email_recipients' })
  emailRecipients: string[];

  @Prop({ type: Boolean, default: false, name: 'whatsapp_enabled' })
  whatsappEnabled: boolean;

  @Prop({ type: Boolean, default: false, name: 'telegram_enabled' })
  telegramEnabled: boolean;

  @Prop({ type: Boolean, default: false, name: 'sms_notifier_enabled' })
  smsNotifierEnabled: boolean;

  /** Numéros E.164 ou locaux pour SMS / WhatsApp ops. */
  @Prop({ type: [String], default: [], name: 'alert_phones' })
  alertPhones: string[];

  /** Identifiants chat Telegram (Bot API). */
  @Prop({ type: [String], default: [], name: 'telegram_chat_ids' })
  telegramChatIds: string[];

  @Prop({ type: Number, default: 15, min: 1, max: 1440, name: 'cooldown_minutes' })
  cooldownMinutes: number;

  @Prop({
    type: String,
    enum: SmsEngineEnum,
    default: SmsEngineEnum.BIRD,
    name: 'sms_engine',
  })
  smsEngine: SmsEngineEnum;

  @Prop({
    type: Map,
    of: MaintenanceAlertStateEntrySchema,
    default: {},
    name: 'last_alert_states',
  })
  lastAlertStates: Map<string, MaintenanceAlertStateEntry>;

  @Prop({
    type: PlatformMaintenanceEntrySchema,
    default: () => ({ enabled: false, message: '' }),
    name: 'vendor_maintenance',
  })
  vendorMaintenance: PlatformMaintenanceEntryModel;

  @Prop({
    type: PlatformMaintenanceEntrySchema,
    default: () => ({ enabled: false, message: '' }),
    name: 'delivery_maintenance',
  })
  deliveryMaintenance: PlatformMaintenanceEntryModel;

  @Prop({
    type: PlatformMaintenanceEntrySchema,
    default: () => ({ enabled: false, message: '' }),
    name: 'customer_maintenance',
  })
  customerMaintenance: PlatformMaintenanceEntryModel;
}

export type MaintenanceAlertSettingsDocument =
  HydratedDocument<MaintenanceAlertSettingsModel>;

export const MaintenanceAlertSettingsSchema = SchemaFactory.createForClass(
  MaintenanceAlertSettingsModel,
);
