import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export enum BusinessStoreReportCategoryEnum {
  SERVICE = 'service',
  QUALITY = 'quality',
  HYGIENE = 'hygiene',
  BILLING = 'billing',
  OTHER = 'other',
}

export enum BusinessStoreReportSeverityEnum {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Signalement client sur une boutique (lié à une commande).
 * Consultation réservée aux comptes `ADMIN` (back-office).
 */
@Schema({
  collection: 'business_store_reports',
  timestamps: true,
})
export class BusinessStoreReportModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'StoreModel',
    required: true,
    index: true,
  })
  store: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'OrderModel',
    required: true,
    index: true,
  })
  order: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: true,
    index: true,
  })
  reporterUser: MongooseSchema.Types.ObjectId;

  @Prop({
    required: false,
    enum: Object.values(BusinessStoreReportCategoryEnum),
  })
  category?: BusinessStoreReportCategoryEnum;

  @Prop({ required: true, trim: true, maxlength: 8000 })
  details: string;

  @Prop({
    required: false,
    enum: Object.values(BusinessStoreReportSeverityEnum),
  })
  severity?: BusinessStoreReportSeverityEnum;

  @Prop({ required: false, default: false, name: 'archived' })
  archived?: boolean;

  @Prop({ required: false, name: 'archived_at' })
  archivedAt?: Date;
}

export type BusinessStoreReportDocument = BusinessStoreReportModel & Document;

export const BusinessStoreReportSchema = SchemaFactory.createForClass(
  BusinessStoreReportModel,
);

BusinessStoreReportSchema.index({ store: 1, createdAt: -1 });
BusinessStoreReportSchema.index({ archived: 1, createdAt: -1 });
BusinessStoreReportSchema.index({ severity: 1, createdAt: -1 });
/** Un seul signalement par commande et par client. */
BusinessStoreReportSchema.index(
  { order: 1, reporterUser: 1 },
  { unique: true },
);
