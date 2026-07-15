import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Document } from 'mongoose';
import { BaseSchema } from './base.schema';
import {
  AdNotificationAddonModel,
  AdNotificationAddonSchema,
} from './ad-notification-addon.schema';
import { AdModerationStatusEnum } from './ad-moderation-status.enum';
import { MarketingOfferListingModel } from './marketing-offer-listing.schema';
import { ProductModel } from './product.schema';
import { StoreModel } from './store.schema';

/** Cible du tap sur la bannière (navigation, contact, lien externe). */
export enum StoreAdActionTypeEnum {
  SHOP = 'SHOP',
  PRODUCT = 'PRODUCT',
  /** Offre exclusive (listing marketing_offer_listings) → checkout direct mobile. */
  EXCLUSIVE_OFFER = 'EXCLUSIVE_OFFER',
  WHATSAPP = 'WHATSAPP',
  CALL = 'CALL',
  EMAIL = 'EMAIL',
  WEBSITE = 'WEBSITE',
}

export enum AdArchiveReasonEnum {
  ENDED = 'ENDED',
  EXPIRED = 'EXPIRED',
}

export { AdModerationStatusEnum } from './ad-moderation-status.enum';

@Schema({
  timestamps: true,
  collection: 'ads',
  toJSON: {
    getters: true,
    virtuals: true,
  },
})
export class AdModel extends BaseSchema {
  @Prop({ default: true, name: 'is_active' })
  isActive: boolean;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true, name: 'subtitle' })
  subtitle: string;

  @Prop({ required: true, name: 'action_text' })
  actionText: string;

  @Prop({ required: false, name: 'image_url' })
  imageUrl?: string;

  @Prop({ default: 0, name: 'sort_order' })
  sortOrder: number;

  /** Si absent : pub générale créée par l’admin (accueil). Sinon : pub liée à une boutique (vendeur / admin ciblé). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: StoreModel.name,
    required: false,
  })
  store?: MongooseSchema.Types.ObjectId;

  /**
   * Région ISO2 cible, ou `ALL` (toutes les régions) pour les bannières globales admin.
   * Pour les pubs boutique, dérivé de la boutique.
   */
  @Prop({ required: false, trim: true, uppercase: true })
  region?: string;

  @Prop({ required: false })
  validFrom?: Date;

  @Prop({ required: false })
  validUntil?: Date;

  @Prop({
    required: false,
    enum: StoreAdActionTypeEnum,
  })
  actionType?: StoreAdActionTypeEnum;

  /**
   * Cible pour WHATSAPP / CALL / EMAIL / WEBSITE (numéro, e-mail, URL).
   * Non utilisé pour SHOP / PRODUCT.
   */
  @Prop({ required: false, name: 'action_target' })
  actionTarget?: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: ProductModel.name,
    required: false,
  })
  product?: MongooseSchema.Types.ObjectId;

  /** Listing offre exclusive (actionType = EXCLUSIVE_OFFER). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: MarketingOfferListingModel.name,
    required: false,
    name: 'marketing_offer_listing',
  })
  marketingOfferListing?: MongooseSchema.Types.ObjectId;

  /** Date d’archivage (Terminer/Expirée). Null/absent = bannière active dans le cycle de vie. */
  @Prop({ required: false, default: null })
  archivedAt?: Date | null;

  @Prop({
    required: false,
    enum: AdArchiveReasonEnum,
    default: null,
  })
  archiveReason?: AdArchiveReasonEnum | null;

  /** Date de finalisation de la facture de la bannière. */
  @Prop({ required: false, default: null })
  billingFinalizedAt?: Date | null;

  /** Montant final figé au moment de la fin (CAD). */
  @Prop({ required: false, default: 0 })
  billingFinalAmountCad?: number;

  @Prop({ required: false, type: MongooseSchema.Types.Mixed, default: null })
  billingSnapshot?: Record<string, unknown> | null;

  /** Taille d’audience ciblée (estimation de coûts / planification). */
  @Prop({ type: Number, required: false, default: null, name: 'audience_total' })
  audienceTotal?: number | null;

  /** Add-on : notifications Email / Push / In-App / SMS / WhatsApp (facturation séparée). */
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

  /** Date d’envoi des notifications add-on (worker). */
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

export const AdSchema = SchemaFactory.createForClass(AdModel);

AdSchema.index({ store: 1, sortOrder: 1 });
AdSchema.index({ region: 1, isActive: 1 });

AdSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export type AdModelDocument = AdModel & Document;
