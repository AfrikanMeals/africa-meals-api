import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { UserModel } from './user.schema';

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'vendor_ops_report_deliveries',
})
export class VendorOpsReportDeliveryModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    index: true,
  })
  owner: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, index: true, name: 'period_key' })
  periodKey: string;

  @Prop({ required: true, trim: true })
  email: string;

  @Prop({ required: true, name: 'sent_at', default: () => new Date() })
  sentAt: Date;
}

export const VendorOpsReportDeliverySchema = SchemaFactory.createForClass(
  VendorOpsReportDeliveryModel,
);

VendorOpsReportDeliverySchema.index(
  { owner: 1, periodKey: 1 },
  { unique: true },
);
