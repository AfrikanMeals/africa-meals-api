import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from './base.schema';

@Schema({
  timestamps: true,
  collection: 'ads',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AdModel extends BaseSchema {
  @Prop({ default: true, name: 'is_active' })
  isActive: boolean;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, name: 'subtitle' })
  subtitle: string;

  @Prop({ required: true, name: 'action_text' })
  actionText: string;

  @Prop({ required: false, name: 'image_url' })
  imageUrl?: string;

  @Prop({ default: 0, name: 'sort_order' })
  sortOrder: number;
}

export const AdSchema = SchemaFactory.createForClass(AdModel);

AdSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export type AdModelDocument = AdModel & Document;
