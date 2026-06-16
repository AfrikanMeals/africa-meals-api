import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PartnerBadgeCode } from '@common/partner-badges/partner-badge.constants';
import { HydratedDocument } from 'mongoose';

@Schema({ timestamps: true, collection: 'partner_badges' })
export class PartnerBadgeModel {
  @Prop({
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    enum: Object.values(PartnerBadgeCode),
  })
  code: PartnerBadgeCode;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 16 })
  icon: string;

  @Prop({ type: Number, required: true, min: 0, max: 30 })
  payoutDelayDays: number;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export type PartnerBadgeDocument = HydratedDocument<PartnerBadgeModel>;

export const PartnerBadgeSchema =
  SchemaFactory.createForClass(PartnerBadgeModel);
