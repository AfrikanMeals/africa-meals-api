import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DatabaseBackupIntervalUnit = 'hour' | 'day' | 'week' | 'month';
export type DatabaseFullBackupSchedule = 'daily' | 'weekly' | 'monthly';

/** Planification sauvegardes / migration (singleton admin). */
@Schema({ timestamps: true, collection: 'database_settings' })
export class DatabaseSettingsModel {
  @Prop({ type: String, default: 'default', unique: true, index: true })
  key: string;

  @Prop({ type: Boolean, default: false })
  incrementalBackupEnabled: boolean;

  @Prop({
    type: String,
    enum: ['hour', 'day', 'week', 'month'],
    default: 'day',
  })
  incrementalBackupIntervalUnit: DatabaseBackupIntervalUnit;

  @Prop({ type: Number, default: 1, min: 1, max: 720 })
  incrementalBackupIntervalValue: number;

  @Prop({ type: Boolean, default: false })
  fullBackupEnabled: boolean;

  @Prop({
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    default: 'weekly',
  })
  fullBackupSchedule: DatabaseFullBackupSchedule;

  /** Heure UTC (0–23) pour la sauvegarde complète planifiée. */
  @Prop({ type: Number, default: 3, min: 0, max: 23 })
  fullBackupHourUtc: number;

  /** Jour de la semaine (1=lundi … 7=dimanche) si hebdomadaire. */
  @Prop({ type: Number, default: 7, min: 1, max: 7 })
  fullBackupDayOfWeek: number;

  /** Jour du mois (1–28) si mensuelle. */
  @Prop({ type: Number, default: 1, min: 1, max: 28 })
  fullBackupDayOfMonth: number;

  @Prop({ type: Number, default: 30, min: 1, max: 3650 })
  backupRetentionDays: number;

  @Prop({ type: Date, default: null })
  lastIncrementalBackupAt?: Date | null;

  @Prop({ type: Date, default: null })
  lastFullBackupAt?: Date | null;
}

export type DatabaseSettingsDocument =
  HydratedDocument<DatabaseSettingsModel>;

export const DatabaseSettingsSchema = SchemaFactory.createForClass(
  DatabaseSettingsModel,
);
