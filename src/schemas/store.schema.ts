import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { AddressModel } from './address.schema';
import { BaseSchema } from './base.schema';
import { StoreRatingModel } from './store_rating.schema';
import { UserModel } from './user.schema';

export enum StoreStatusEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Schema({
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class StoreShippingZoneModel {
  [x: string]: any;
  @Prop({ required: true, name: 'min_distance' })
  minDistance: number;

  @Prop({ required: true, name: 'max_distance' })
  maxDistance: number;

  @Prop({ required: true, name: 'price' })
  price: number;

  // Computed
  label?: string;
}

@Schema({
  timestamps: true,
  collection: 'stores',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class StoreModel extends BaseSchema {
  @Prop({ required: true, name: 'name' })
  name: string;

  @Prop({ required: true, name: 'bio' })
  bio?: string;

  @Prop({ required: true, name: 'email' })
  email: string;

  @Prop({ required: true, name: 'phone_number' })
  phoneNumber: string;

  @Prop({ required: true, name: 'currency', default: 'CAD' })
  currency: string;

  @Prop({ required: false, name: 'profile_image' })
  profileImage?: string;

  @Prop({ default: false, name: 'accepts_orders' }) // TODO should be updated when activating the store
  acceptsOrders?: boolean;

  @Prop({ default: false, name: 'can_create_products' }) // TODO should be updated when activating the store
  canCreateProducts?: boolean;

  @Prop({ default: false, name: 'supports_shipping' })
  supportsShipping?: boolean;

  @Prop({
    required: true,
    name: 'status',
    enum: StoreStatusEnum,
    default: StoreStatusEnum.PENDING,
  })
  status: StoreStatusEnum;

  @Prop({
    required: true,
    name: 'address',
    ref: AddressModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  address: AddressModel;

  @Prop({
    required: true,
    name: 'ratings',
    ref: StoreRatingModel.name,
    type: [MongooseSchema.Types.ObjectId],
    select: false,
    default: [],
  })
  ratings: StoreRatingModel[];

  @Prop({
    required: true,
    name: 'owner',
    ref: 'UserModel',
    type: MongooseSchema.Types.ObjectId,
  })
  owner: UserModel;

  @Prop({
    default: [],
    name: 'owner',
    ref: 'UserModel',
    type: [MongooseSchema.Types.ObjectId],
  })
  likedBy: UserModel[];

  @Prop({
    default: [],
    name: 'shipping_zones',
    type: Array<StoreShippingZoneModel>,
    get: (value: StoreShippingZoneModel[]) => {
      return (value || []).map((item) => {
        return {
          ...item,
          label: `${item.minDistance} - ${item.maxDistance}KM`,
        };
      });
    },
  })
  shippingZones: StoreShippingZoneModel[];
}

export const StoreSchema = SchemaFactory.createForClass(StoreModel);

StoreSchema.virtual('averageRating').get(function () {
  const items = this.ratings || [];
  if (!items.length) {
    return 0;
  }
  return (
    items.reduce((a: number, b: StoreRatingModel) => a + b.rate, 0) /
    items.length
  );
});

export type StoreModelDocument = StoreModel & Document;
