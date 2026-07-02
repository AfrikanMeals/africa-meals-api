import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum MarketingOfferModerationStatusEnum {
  APPROVED = 'approved',
  BLOCKED = 'blocked',
}

@Schema({ timestamps: true, collection: 'marketing_offer_sections' })
export class MarketingOfferSectionModel {
  @Prop({ type: String, required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: String, required: true, trim: true })
  titleFr: string;

  @Prop({ type: String, required: true, trim: true })
  titleEn: string;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export type MarketingOfferSectionDocument =
  HydratedDocument<MarketingOfferSectionModel>;

export const MarketingOfferSectionSchema = SchemaFactory.createForClass(
  MarketingOfferSectionModel,
);

@Schema({ timestamps: true, collection: 'marketing_offers' })
export class MarketingOfferModel {
  @Prop({ type: Number, required: true, unique: true, min: 1, max: 999 })
  number: number;

  @Prop({ type: String, required: true, unique: true, trim: true })
  type: string;

  @Prop({
    type: Types.ObjectId,
    ref: MarketingOfferSectionModel.name,
    required: true,
    index: true,
  })
  sectionId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, trim: true })
  rule: string;

  @Prop({ type: String, required: true, trim: true })
  example: string;

  @Prop({ type: String, required: true, trim: true })
  phase: string;

  @Prop({ type: String, required: true, trim: true })
  priority: string;

  @Prop({ type: String, required: true, trim: true })
  complexity: string;

  @Prop({
    type: String,
    enum: Object.values(MarketingOfferModerationStatusEnum),
    default: MarketingOfferModerationStatusEnum.APPROVED,
    index: true,
  })
  moderationStatus: MarketingOfferModerationStatusEnum;
}

export type MarketingOfferDocument = HydratedDocument<MarketingOfferModel>;

export const MarketingOfferSchema =
  SchemaFactory.createForClass(MarketingOfferModel);

@Schema({ timestamps: true, collection: 'marketing_offer_items' })
export class MarketingOfferItemModel {
  @Prop({
    type: Types.ObjectId,
    ref: MarketingOfferModel.name,
    required: true,
    index: true,
  })
  offerId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  titleFr: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 120 })
  titleEn: string;

  @Prop({ type: String, trim: true, maxlength: 2000, default: '' })
  descriptionFr: string;

  @Prop({ type: String, trim: true, maxlength: 2000, default: '' })
  descriptionEn: string;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export type MarketingOfferItemDocument =
  HydratedDocument<MarketingOfferItemModel>;

export const MarketingOfferItemSchema = SchemaFactory.createForClass(
  MarketingOfferItemModel,
);
