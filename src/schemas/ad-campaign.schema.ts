import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { BaseSchema } from './base.schema';
import {
  AdNotificationAddonModel,
  AdNotificationAddonSchema,
} from './ad-notification-addon.schema';
import { DrinkModel } from './drink.schema';
import { MarketingOfferListingModel } from './marketing-offer-listing.schema';
import { ProductModel } from './product.schema';
import { StoreModel } from './store.schema';
import { AdModerationStatusEnum, StoreAdActionTypeEnum } from './ad.schema';

export enum AdCampaignItemTypeEnum {
  PRODUCT = 'PRODUCT',
  DRINK = 'DRINK',
  EXCLUSIVE_OFFER = 'EXCLUSIVE_OFFER',
}

export enum AdCampaignArchiveReasonEnum {
  ENDED = 'ENDED',
  EXPIRED = 'EXPIRED',
}

@Schema({ _id: false })
export class AdCampaignItemModel {
  @Prop({ required: true, enum: AdCampaignItemTypeEnum })
  itemType: AdCampaignItemTypeEnum;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: ProductModel.name,
  })
  product?: ProductModel;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: DrinkModel.name,
  })
  drink?: DrinkModel;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: MarketingOfferListingModel.name,
    name: 'marketing_offer_listing',
  })
  marketingOfferListing?: MarketingOfferListingModel;
}

export const AdCampaignItemSchema =
  SchemaFactory.createForClass(AdCampaignItemModel);

@Schema({
  timestamps: true,
  collection: 'ad_campaigns',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AdCampaignModel extends BaseSchema {
  @Prop({
    required: true,
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    name: 'store',
  })
  store: StoreModel;

  @Prop({ required: true, name: 'title', trim: true })
  title: string;

  @Prop({ required: false, name: 'subtitle', trim: true })
  subtitle?: string;

  @Prop({ required: false, name: 'description', trim: true })
  description?: string;

  @Prop({ required: true, name: 'starts_at' })
  startsAt: Date;

  @Prop({ required: true, name: 'ends_at' })
  endsAt: Date;

  @Prop({ default: true, name: 'is_active' })
  isActive: boolean;

  @Prop({
    required: true,
    enum: StoreAdActionTypeEnum,
    default: StoreAdActionTypeEnum.SHOP,
    name: 'action_type',
  })
  actionType: StoreAdActionTypeEnum;

  @Prop({ required: false, name: 'action_target', trim: true })
  actionTarget?: string;

  @Prop({
    required: true,
    trim: true,
    default: 'Découvrir',
    name: 'action_text',
  })
  actionText: string;

  @Prop({
    type: [AdCampaignItemSchema],
    default: [],
    name: 'items',
  })
  items: AdCampaignItemModel[];

  @Prop({
    required: false,
    type: MongooseSchema.Types.Mixed,
    default: {},
    name: 'targeting_rules',
  })
  targetingRules?: Record<string, unknown>;

  @Prop({ required: false, name: 'archived_at' })
  archivedAt?: Date;

  @Prop({
    required: false,
    enum: AdCampaignArchiveReasonEnum,
    name: 'archive_reason',
  })
  archiveReason?: AdCampaignArchiveReasonEnum;

  /** Facturation figée au moment de la clôture (fin manuelle ou expiration). */
  @Prop({ required: false, name: 'billing_finalized_at' })
  billingFinalizedAt?: Date;

  @Prop({ required: false, name: 'billing_final_amount_cad', default: 0 })
  billingFinalAmountCad?: number;

  @Prop({
    required: false,
    type: MongooseSchema.Types.Mixed,
    default: {},
    name: 'billing_snapshot',
  })
  billingSnapshot?: Record<string, unknown>;

  @Prop({ type: Number, required: false, default: null, name: 'audience_total' })
  audienceTotal?: number | null;

  @Prop({
    type: AdNotificationAddonSchema,
    default: () => ({
      enabled: false,
      channels: {
        email: false,
        push: false,
        inApp: false,
        sms: false,
        whatsapp: false,
      },
    }),
    name: 'notification_addon',
  })
  notificationAddon?: AdNotificationAddonModel;

  @Prop({ required: false, default: null, name: 'notification_dispatched_at' })
  notificationDispatchedAt?: Date | null;

  @Prop({
    required: false,
    enum: AdModerationStatusEnum,
    default: AdModerationStatusEnum.APPROVED,
    name: 'moderation_status',
  })
  moderationStatus?: AdModerationStatusEnum;

  @Prop({ required: false, maxlength: 500, name: 'rejection_reason' })
  rejectionReason?: string;

  @Prop({ required: false, default: null, name: 'reviewed_at' })
  reviewedAt?: Date | null;

  @Prop({
    required: false,
    type: MongooseSchema.Types.ObjectId,
    ref: 'UserModel',
    default: null,
    name: 'reviewed_by',
  })
  reviewedBy?: MongooseSchema.Types.ObjectId | null;
}

export const AdCampaignSchema = SchemaFactory.createForClass(AdCampaignModel);
AdCampaignSchema.index({ store: 1, startsAt: 1, endsAt: 1, isActive: 1 });

export type AdCampaignModelDocument = AdCampaignModel & Document;
