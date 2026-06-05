import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

export enum VendorAnalyticsEventTypeEnum {
  STORE_PAGE_VIEW = 'store_page_view',
  PRODUCT_VIEW = 'product_view',
  DRINK_VIEW = 'drink_view',
  STORE_ENGAGEMENT = 'store_engagement',
  STORE_SESSION = 'store_session',
}

export enum VendorAnalyticsItemKindEnum {
  PRODUCT = 'product',
  DRINK = 'drink',
}

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'vendor_analytics_events',
})
export class VendorAnalyticsEventModel {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'StoreModel',
    required: true,
    index: true,
  })
  store: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    required: false,
    index: true,
  })
  user?: Types.ObjectId;

  @Prop({
    required: true,
    enum: Object.values(VendorAnalyticsEventTypeEnum),
    index: true,
  })
  eventType: VendorAnalyticsEventTypeEnum;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: false, index: true })
  itemId?: Types.ObjectId;

  @Prop({
    required: false,
    enum: Object.values(VendorAnalyticsItemKindEnum),
  })
  itemKind?: VendorAnalyticsItemKindEnum;

  /** Durée de session boutique (secondes), pour `store_session`. */
  @Prop({ required: false, min: 0 })
  durationSec?: number;

  /** Ex. `tab_drinks`, `add_to_cart`, `open_product`. */
  @Prop({ required: false, trim: true, maxlength: 64 })
  engagement?: string;

  @Prop({ required: false, default: 'mobile', maxlength: 16 })
  source?: string;
}

export const VendorAnalyticsEventSchema = SchemaFactory.createForClass(
  VendorAnalyticsEventModel,
);

VendorAnalyticsEventSchema.index({ store: 1, createdAt: -1 });
VendorAnalyticsEventSchema.index({ store: 1, eventType: 1, createdAt: -1 });
VendorAnalyticsEventSchema.index({ itemId: 1, eventType: 1, createdAt: -1 });
