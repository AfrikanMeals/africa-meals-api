import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

export enum SiteContactRequestMailStatusEnum {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

@Schema({
  timestamps: true,
  collection: 'site_contact_requests',
})
export class SiteContactRequestModel extends BaseSchema {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 254 })
  email: string;

  @Prop({ required: false, trim: true, maxlength: 200, default: '' })
  subject?: string;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  message: string;

  @Prop({
    required: true,
    enum: SiteContactRequestMailStatusEnum,
    default: SiteContactRequestMailStatusEnum.PENDING,
  })
  mailStatus: SiteContactRequestMailStatusEnum;

  @Prop({ required: false, trim: true, maxlength: 500, default: '' })
  mailError?: string;
}

export const SiteContactRequestSchema = SchemaFactory.createForClass(
  SiteContactRequestModel,
);

SiteContactRequestSchema.index({ createdAt: -1 });
SiteContactRequestSchema.index({ mailStatus: 1, createdAt: -1 });

export type SiteContactRequestModelDocument = SiteContactRequestModel &
  Document;
