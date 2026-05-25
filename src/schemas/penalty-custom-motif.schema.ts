import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';

@Schema({
  timestamps: true,
  collection: 'penalty_custom_motifs',
})
export class PenaltyCustomMotifModel extends BaseSchema {
  /** Code stable (ex. `custom_retard_grave`), utilisé comme `reasonCode`. */
  @Prop({ required: true, unique: true, trim: true, maxlength: 64 })
  code: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  labelFr: string;

  @Prop({ required: true, default: true })
  active: boolean;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
  })
  createdByAdmin?: string;
}

export const PenaltyCustomMotifSchema = SchemaFactory.createForClass(
  PenaltyCustomMotifModel,
);
