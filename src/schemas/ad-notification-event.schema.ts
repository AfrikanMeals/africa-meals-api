import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { AdCampaignModel } from './ad-campaign.schema';
import { AdModel } from './ad.schema';
import { StoreModel } from './store.schema';
import { UserModel } from './user.schema';

export enum AdNotificationEntityTypeEnum {
  BANNER = 'BANNER',
  CAMPAIGN = 'CAMPAIGN',
}

export enum AdNotificationChannelEnum {
  EMAIL = 'email',
  PUSH = 'push',
  IN_APP = 'inApp',
  SMS = 'sms',
  WHATSAPP = 'whatsapp',
}

/** Une livraison notification = un document (interaction/conversion mises à jour sur le même deliveryId). */
@Schema({
  timestamps: { createdAt: true, updatedAt: true },
  collection: 'ad_notification_events',
})
export class AdNotificationEventModel {
  @Prop({ required: true, unique: true, index: true, name: 'delivery_id' })
  deliveryId: string;

  @Prop({ required: true, enum: AdNotificationEntityTypeEnum, name: 'entity_type' })
  entityType: AdNotificationEntityTypeEnum;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: false,
    ref: AdModel.name,
  })
  ad?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: false,
    ref: AdCampaignModel.name,
  })
  campaign?: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: true,
  })
  store: MongooseSchema.Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: UserModel.name,
    required: true,
  })
  user: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, enum: AdNotificationChannelEnum })
  channel: AdNotificationChannelEnum;

  @Prop({ required: true, name: 'delivered_at', default: () => new Date() })
  deliveredAt: Date;

  @Prop({ required: false, default: null, name: 'interaction_at' })
  interactionAt?: Date | null;

  @Prop({ required: false, default: null, name: 'conversion_at' })
  conversionAt?: Date | null;

  /** Article ciblé pour ce destinataire (deep link produit/boisson). */
  @Prop({ required: false, name: 'target_item_type' })
  targetItemType?: string | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: false,
    name: 'target_product_id',
  })
  targetProductId?: MongooseSchema.Types.ObjectId | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: false,
    name: 'target_drink_id',
  })
  targetDrinkId?: MongooseSchema.Types.ObjectId | null;
}

export const AdNotificationEventSchema = SchemaFactory.createForClass(
  AdNotificationEventModel,
);

AdNotificationEventSchema.index({ ad: 1, channel: 1 });
AdNotificationEventSchema.index({ campaign: 1, channel: 1 });
AdNotificationEventSchema.index({ store: 1, createdAt: -1 });
