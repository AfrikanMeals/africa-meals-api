import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

@Schema({
  timestamps: true,
  collection: 'store_ratings',
})
export class StoreRatingModel extends BaseSchema {
  @Prop({ required: true, name: 'rate', min: 1, max: 5 })
  rate: number;

  @Prop({
    required: true,
    name: 'user',
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
  })
  user: UserModel;

  @Prop({
    required: true,
    name: 'store',
    ref: 'StoreModel',
    type: MongooseSchema.Types.ObjectId,
  })
  store: StoreModel;
}

export const StoreRatingSchema = SchemaFactory.createForClass(StoreRatingModel);

export type StoreRatingModelDocument = StoreRatingModel & Document;
