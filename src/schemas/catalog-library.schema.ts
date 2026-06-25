import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import { BaseSchema } from './base.schema';
import { StoreModel } from './store.schema';

@Schema({
  timestamps: true,
  collection: 'store_ingredient_library',
  toJSON: { getters: true, virtuals: true },
})
export class StoreIngredientLibraryModel extends BaseSchema {
  @Prop({
    required: true,
    name: 'store',
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
    index: true,
  })
  store: Types.ObjectId;

  @Prop({ required: true, name: 'name', trim: true })
  name: string;
}

export const StoreIngredientLibrarySchema = SchemaFactory.createForClass(
  StoreIngredientLibraryModel,
);
StoreIngredientLibrarySchema.index({ store: 1, name: 1 });

@Schema({
  timestamps: true,
  collection: 'store_supplement_library',
  toJSON: { getters: true, virtuals: true },
})
export class StoreSupplementLibraryModel extends BaseSchema {
  @Prop({
    required: true,
    name: 'store',
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
    index: true,
  })
  store: Types.ObjectId;

  @Prop({ required: true, name: 'name', trim: true })
  name: string;

  @Prop({ required: false, name: 'default_price', default: 0 })
  defaultPrice: number;
}

export const StoreSupplementLibrarySchema = SchemaFactory.createForClass(
  StoreSupplementLibraryModel,
);
StoreSupplementLibrarySchema.index({ store: 1, name: 1 });

@Schema({ _id: false })
export class StoreComplementLibraryOptionModel {
  @Prop({ required: true, name: 'label' })
  label: string;

  @Prop({ required: false, name: 'default_price_delta', default: 0 })
  defaultPriceDelta: number;

  @Prop({ required: false, name: 'is_default', default: false })
  isDefault: boolean;
}

export const StoreComplementLibraryOptionSchema = SchemaFactory.createForClass(
  StoreComplementLibraryOptionModel,
);

@Schema({
  timestamps: true,
  collection: 'store_complement_library',
  toJSON: { getters: true, virtuals: true },
})
export class StoreComplementLibraryModel extends BaseSchema {
  @Prop({
    required: true,
    name: 'store',
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
    index: true,
  })
  store: Types.ObjectId;

  @Prop({ required: true, name: 'title', trim: true })
  title: string;

  @Prop({ required: false, name: 'first_option_free', default: false })
  firstOptionFree: boolean;

  @Prop({ required: false, name: 'multi_choice', default: false })
  multiChoice: boolean;

  @Prop({ required: false, name: 'required', default: false })
  required: boolean;

  @Prop({
    required: true,
    name: 'options',
    type: [StoreComplementLibraryOptionSchema],
    default: [],
  })
  options: StoreComplementLibraryOptionModel[];
}

export const StoreComplementLibrarySchema = SchemaFactory.createForClass(
  StoreComplementLibraryModel,
);
StoreComplementLibrarySchema.index({ store: 1, title: 1 });
