import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';

export enum AddressTypeEnum {
  USER = 'USER',
  SHOP = 'SHOP',
}

@Schema({
  timestamps: true,
  collection: 'addresses',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AddressModel extends BaseSchema {
  @Prop({ default: false, name: 'is_default' })
  isDefault: boolean;

  @Prop({ required: true, name: 'address' })
  address: string;

  @Prop({ required: true, name: 'country' })
  country: string;

  @Prop({ required: true, name: 'city' })
  city: string;

  @Prop({ required: true, name: 'country_code' })
  countryCode: string;

  @Prop({ required: true, name: 'zip_code' })
  zipCode: string;

  @Prop({
    required: true,
    name: 'type',
    enum: AddressTypeEnum,
    default: AddressTypeEnum.USER,
  })
  type: AddressTypeEnum;

  @Prop({
    type: {
      type: MongooseSchema.Types.String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  })
  location: {
    type: string;
    coordinates: number[];
  };
}

export const AddressSchema = SchemaFactory.createForClass(AddressModel);

export type AddressModelDocument = AddressModel & Document;

AddressSchema.index({ location: '2dsphere' });
