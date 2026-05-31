import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

@Schema({
  timestamps: true,
  collection: 'vendor_feedbacks',
})
export class VendorFeedbackModel extends BaseSchema {
  @Prop({
    required: true,
    name: 'user',
    ref: UserModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  user: UserModel;

  @Prop({ required: true, name: 'rate', min: 1, max: 5 })
  rate: number;

  @Prop({ required: false, name: 'comment', trim: true })
  comment?: string;
}

export const VendorFeedbackSchema =
  SchemaFactory.createForClass(VendorFeedbackModel);

VendorFeedbackSchema.index({ user: 1, createdAt: -1 });

export type VendorFeedbackModelDocument = VendorFeedbackModel & Document;
