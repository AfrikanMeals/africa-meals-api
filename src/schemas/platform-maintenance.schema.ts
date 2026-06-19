import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum MaintenancePlatformEnum {
  VENDOR = 'vendor',
  DELIVERY = 'delivery',
  CUSTOMER = 'customer',
}

@Schema({ _id: false })
export class PlatformMaintenanceEntryModel {
  @Prop({ type: Boolean, default: false })
  enabled: boolean;

  @Prop({ type: String, default: '', trim: true })
  message: string;

  @Prop({ type: Date, default: null })
  toggledAt?: Date | null;

  @Prop({ type: String, default: '', trim: true })
  toggledByUserId?: string;

  @Prop({ type: String, default: '', trim: true })
  toggledByEmail?: string;
}

export const PlatformMaintenanceEntrySchema = SchemaFactory.createForClass(
  PlatformMaintenanceEntryModel,
);
