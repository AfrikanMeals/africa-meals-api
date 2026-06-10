import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

export enum NewsletterSubscriberStatusEnum {
  ACTIVE = 'ACTIVE',
  UNSUBSCRIBED = 'UNSUBSCRIBED',
}

@Schema({
  timestamps: true,
  collection: 'newsletter_subscribers',
})
export class NewsletterSubscriberModel extends BaseSchema {
  @Prop({ required: true, trim: true, lowercase: true, maxlength: 254 })
  email: string;

  @Prop({ required: false, trim: true, maxlength: 10, default: '' })
  locale?: string;

  @Prop({ required: false, trim: true, maxlength: 40, default: 'footer' })
  source?: string;

  @Prop({
    required: true,
    enum: NewsletterSubscriberStatusEnum,
    default: NewsletterSubscriberStatusEnum.ACTIVE,
  })
  status: NewsletterSubscriberStatusEnum;
}

export const NewsletterSubscriberSchema = SchemaFactory.createForClass(
  NewsletterSubscriberModel,
);

NewsletterSubscriberSchema.index({ email: 1 }, { unique: true });
NewsletterSubscriberSchema.index({ status: 1, createdAt: -1 });
NewsletterSubscriberSchema.index({ createdAt: -1 });

export type NewsletterSubscriberModelDocument = NewsletterSubscriberModel &
  Document;
