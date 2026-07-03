import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { MarketingOfferModel } from './marketing-offer.schema';
import { ProductModel } from './product.schema';
import { StoreModel } from './store.schema';

export enum MarketingOfferListingStatusEnum {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Schema({ timestamps: true, collection: 'marketing_offer_listings' })
export class MarketingOfferListingModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
    index: true,
  })
  storeId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: MarketingOfferModel.name,
    required: true,
    index: true,
  })
  marketingOfferId: Types.ObjectId;

  /** Identifiant machine (ex. BOGO_1) — dénormalisé pour requêtes feed. */
  @Prop({ type: String, required: true, trim: true, index: true })
  marketingOfferType: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: ProductModel.name,
    required: true,
    index: true,
  })
  productId: Types.ObjectId;

  /** Surcharge BUY_X_GET_Y (X achetés). */
  @Prop({ type: Number, min: 1, max: 99 })
  buyQuantity?: number;

  /** Surcharge BUY_X_GET_Y (Y offerts). */
  @Prop({ type: Number, min: 0, max: 99 })
  getQuantity?: number;

  /** Remise % pour stratégies produit (ex. FLASH_SALE_28). */
  @Prop({ type: Number, min: 1, max: 99 })
  rewardPercent?: number;

  /** Seuil panier (stratégies SPEND_X). */
  @Prop({ type: Number, min: 0 })
  spendThreshold?: number;

  /** Remise fixe au seuil (SPEND_X_GET_Y_OFF). */
  @Prop({ type: Number, min: 0 })
  rewardFixedAmount?: number;

  @Prop({
    type: String,
    enum: Object.values(MarketingOfferListingStatusEnum),
    default: MarketingOfferListingStatusEnum.ACTIVE,
    index: true,
  })
  status: MarketingOfferListingStatusEnum;

  /** Score engagement (clics carrousel, commandes) pour le feed. */
  @Prop({ type: Number, default: 0, min: 0 })
  engagementScore: number;

  @Prop({ type: Date })
  validFrom?: Date;

  @Prop({ type: Date })
  validUntil?: Date;
}

export type MarketingOfferListingDocument =
  HydratedDocument<MarketingOfferListingModel>;

export const MarketingOfferListingSchema = SchemaFactory.createForClass(
  MarketingOfferListingModel,
);

MarketingOfferListingSchema.index(
  { storeId: 1, productId: 1, marketingOfferId: 1 },
  { unique: true },
);
