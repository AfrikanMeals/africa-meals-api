import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum AdminOpsReportPeriodEnum {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

@Schema({ timestamps: true, collection: 'admin_ops_report_settings' })
export class AdminOpsReportSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: false, name: 'enabled' })
  enabled: boolean;

  @Prop({
    type: String,
    enum: AdminOpsReportPeriodEnum,
    default: AdminOpsReportPeriodEnum.WEEKLY,
    name: 'period',
  })
  period: AdminOpsReportPeriodEnum;

  @Prop({
    type: [String],
    default: [],
    name: 'recipient_emails',
  })
  recipientEmails: string[];

  @Prop({
    type: String,
    default: 'America/Toronto',
    trim: true,
    name: 'timezone',
  })
  timezone: string;

  /** Heure locale (0–23) à partir de laquelle le cron peut envoyer le rapport. */
  @Prop({ type: Number, default: 8, name: 'send_hour_local' })
  sendHourLocal: number;

  @Prop({ required: false, default: null, name: 'last_sent_at' })
  lastSentAt?: Date | null;

  @Prop({ required: false, default: null, name: 'last_sent_period_key' })
  lastSentPeriodKey?: string | null;
}

export type AdminOpsReportSettingsDocument =
  HydratedDocument<AdminOpsReportSettingsModel>;

export const AdminOpsReportSettingsSchema = SchemaFactory.createForClass(
  AdminOpsReportSettingsModel,
);
