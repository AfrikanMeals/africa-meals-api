import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { UserModel } from './user.schema';

export enum RatingTypeEnum {
  PRODUCT = 'PRODUCT',
  STORE = 'STORE',
}

@Schema({
  timestamps: true,
  collection: 'ratings',
})
export class RatingModel extends BaseSchema {
  @Prop({ required: true, name: 'rate', min: 1, max: 5 })
  rate: number;

  @Prop({ required: true, name: 'type', enum: RatingTypeEnum })
  type: RatingTypeEnum;

  @Prop({
    required: true,
    name: 'user',
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
  })
  user: UserModel;
}

export const RatingSchema = SchemaFactory.createForClass(RatingModel);

export type RatingModelDocument = RatingModel & Document;
