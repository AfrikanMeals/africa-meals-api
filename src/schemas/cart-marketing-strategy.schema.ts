import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { MarketingOfferListingModel } from './marketing-offer-listing.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

/** Stratégie panier active pour une boutique (checkout direct carrousel). */
@Schema({ timestamps: true, collection: 'cart_marketing_strategies' })
export class CartMarketingStrategyModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
    index: true,
  })
  userId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  storeId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: MarketingOfferListingModel.name,
    required: true,
  })
  listingId: Types.ObjectId;
}

export type CartMarketingStrategyDocument =
  HydratedDocument<CartMarketingStrategyModel>;

export const CartMarketingStrategySchema = SchemaFactory.createForClass(
  CartMarketingStrategyModel,
);

CartMarketingStrategySchema.index(
  { userId: 1, storeId: 1 },
  { unique: true },
);
