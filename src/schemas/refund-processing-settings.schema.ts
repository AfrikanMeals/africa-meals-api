import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';

/** Singleton : pause globale du traitement automatique des remboursements. */
@Schema({
  timestamps: true,
  collection: 'refund_processing_settings',
})
export class RefundProcessingSettingsModel extends BaseSchema {
  @Prop({ required: true, default: 'default', unique: true })
  key: string;

  @Prop({ required: true, default: false, name: 'processing_paused' })
  processingPaused: boolean;

  @Prop({ required: false, name: 'paused_at', type: Date })
  pausedAt?: Date;

  @Prop({
    required: false,
    name: 'paused_by',
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  pausedBy?: string;

  @Prop({ required: false, name: 'pause_note', maxlength: 500 })
  pauseNote?: string;
}

export const RefundProcessingSettingsSchema = SchemaFactory.createForClass(
  RefundProcessingSettingsModel,
);
