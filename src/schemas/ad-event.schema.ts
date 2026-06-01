import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Document } from 'mongoose';
import { AdModel } from './ad.schema';
import { UserModel } from './user.schema';

export enum AdEventTypeEnum {
  IMPRESSION = 'IMPRESSION',
  CLICK = 'CLICK',
  CONVERSION = 'CONVERSION',
}

export enum AdConversionSourceEnum {
  BANNER_PRODUCT = 'BANNER_PRODUCT',
  BANNER_STORE = 'BANNER_STORE',
  BANNER_GENERIC = 'BANNER_GENERIC',
}

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'ad_events',
})
export class AdEventModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: AdModel.name,
    required: true,
    index: true,
  })
  ad: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: false,
  })
  user?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: AdEventTypeEnum })
  eventType: AdEventTypeEnum;

  /** Identifiant stable côté app (ex. UUID stocké) pour regrouper les invités. */
  @Prop({ required: false, maxlength: 128 })
  clientInstallId?: string;

  /** Commande associée pour les conversions attribuées. */
  @Prop({ required: false, maxlength: 64, index: true })
  orderId?: string;

  /** Source d'attribution de conversion (audit marketing). */
  @Prop({ required: false, enum: AdConversionSourceEnum, maxlength: 32 })
  conversionSource?: AdConversionSourceEnum;
}

export const AdEventSchema = SchemaFactory.createForClass(AdEventModel);

AdEventSchema.index({ ad: 1, createdAt: -1 });
AdEventSchema.index({ ad: 1, eventType: 1, createdAt: -1 });

export type AdEventModelDocument = AdEventModel & Document;
