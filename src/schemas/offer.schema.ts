import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import dayjs from 'dayjs';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import { ProductExtraModel, ProductModel } from './product.schema';
import { StoreModel } from './store.schema';

export enum OfferStatusEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum OfferItemTypeEnum {
  PRODUCT = 'product',
  PRODUCT_EXTRA = 'product_extra',
}

@Schema({
  timestamps: true,
  collection: 'offer_items',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class OfferItemModel extends BaseSchema {
  @Prop({
    required: true,
    name: 'type',
    enum: OfferItemTypeEnum,
  })
  type: OfferItemTypeEnum;

  @Prop({ required: false, name: 'product_id' }) // Required when type is 'product_extra'
  productId?: string;

  @Prop({ required: true, name: 'entity_id' })
  entityId: string;

  @Prop({ required: true, name: 'quantity', default: 1 })
  quantity: number;

  @Prop({ required: true, name: 'price' })
  price: number;

  // Computed properties
  entity?: ProductModel | ProductExtraModel;
}

export const OfferItemExtraSchema =
  SchemaFactory.createForClass(OfferItemModel);

export type OfferItemModelDocument = OfferItemModel & Document;

@Schema({
  timestamps: true,
  collection: 'offers',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class OfferModel extends BaseSchema {
  @Prop({ required: true, name: 'title' })
  title: string;

  @Prop({ required: true, name: 'price' })
  price: number;

  @Prop({ required: true, name: 'discount_price' })
  discountPrice: number;

  @Prop({ required: false, name: 'description' })
  description?: string;

  @Prop({ required: false, name: 'start_date' })
  startDate?: Date;

  @Prop({ required: false, name: 'end_date' })
  endDate?: Date;

  @Prop({ required: false, name: 'profile_image' })
  profileImage?: string;

  @Prop({
    required: true,
    name: 'store',
    ref: StoreModel.name,
    type: MongooseSchema.Types.ObjectId,
  })
  store: StoreModel;

  @Prop({
    required: true,
    name: 'status',
    enum: OfferStatusEnum,
    default: OfferStatusEnum.ACTIVE,
  })
  status: OfferStatusEnum;

  @Prop({
    default: [],
    name: 'items',
    type: [OfferItemModel],
    validate: {
      validator: (value: string[]) => {
        return value.length > 1;
      },
    },
  })
  items: OfferItemModel[];

  // Computed properties
  products: ProductModel[];
}

export const OfferSchema = SchemaFactory.createForClass(OfferModel);

OfferSchema.virtual('canBeOrdered').get(function (this: OfferModel) {
  if (this.startDate && this.endDate) {
    const now = dayjs();
    return now.isAfter(this.startDate) && now.isBefore(this.endDate);
  }
  return this.status === OfferStatusEnum.ACTIVE;
});

OfferSchema.virtual('discountPercentage').get(function (this: OfferModel) {
  if (this.discountPrice > 0) {
    return Math.round(((this.discountPrice - this.price) / this.price) * 100);
  }
  return 0;
});
export type OfferModelDocument = OfferModel & Document;
