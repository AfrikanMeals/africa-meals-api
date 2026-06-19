import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const VENDOR_GUIDE_SLUG_REGEX = /^[a-z][a-z0-9-]{0,63}$/;

export function normalizeVendorGuideSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, '-');
}

export function isValidVendorGuideSlug(slug: string): boolean {
  return VENDOR_GUIDE_SLUG_REGEX.test(slug);
}

export enum VendorGuideActionTypeEnum {
  NONE = 'none',
  LINK = 'link',
  ROUTE = 'route',
}

@Schema({ timestamps: true, collection: 'vendor_guide_articles' })
export class VendorGuideArticleModel {
  @Prop({ type: String, required: true, trim: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '', trim: true, name: 'image_url' })
  imageUrl: string;

  @Prop({ type: String, default: '', trim: true, name: 'html_content' })
  htmlContent: string;

  @Prop({
    type: String,
    enum: VendorGuideActionTypeEnum,
    default: VendorGuideActionTypeEnum.NONE,
    name: 'action_type',
  })
  actionType: VendorGuideActionTypeEnum;

  @Prop({ type: String, default: '', trim: true, name: 'action_label' })
  actionLabel: string;

  @Prop({ type: String, default: '', trim: true, name: 'action_target' })
  actionTarget: string;

  @Prop({ type: Number, default: 0, name: 'sort_order' })
  sortOrder: number;

  @Prop({ type: Boolean, default: false, name: 'is_active' })
  isActive: boolean;
}

export type VendorGuideArticleDocument =
  HydratedDocument<VendorGuideArticleModel>;

export const VendorGuideArticleSchema = SchemaFactory.createForClass(
  VendorGuideArticleModel,
);

VendorGuideArticleSchema.index({ slug: 1, locale: 1 }, { unique: true });
VendorGuideArticleSchema.index({ locale: 1, isActive: 1, sortOrder: 1 });

@Schema({ timestamps: true, collection: 'vendor_guide_settings' })
export class VendorGuideSettingsModel {
  @Prop({ type: String, required: true, unique: true, default: 'default' })
  key: string;

  /** Nombre de jours après création boutique avant affichage. */
  @Prop({ type: Number, default: 0, name: 'send_after_days' })
  sendAfterDays: number;

  /** Nombre d’articles affichés par session (carrousel). */
  @Prop({ type: Number, default: 3, name: 'articles_per_batch' })
  articlesPerBatch: number;

  /**
   * Jours avant réaffichage d’un guide déjà vu (0 = jamais réafficher).
   */
  @Prop({ type: Number, default: 0, name: 'redisplay_after_days' })
  redisplayAfterDays: number;

  @Prop({ type: Boolean, default: true, name: 'is_enabled' })
  isEnabled: boolean;
}

export type VendorGuideSettingsDocument =
  HydratedDocument<VendorGuideSettingsModel>;

export const VendorGuideSettingsSchema = SchemaFactory.createForClass(
  VendorGuideSettingsModel,
);

/** Progression vendeur : guides déjà vus ou ignorés. */
@Schema({ timestamps: true, collection: 'vendor_guide_progress' })
export class VendorGuideProgressModel {
  @Prop({ type: String, required: true, index: true, name: 'user_id' })
  userId: string;

  @Prop({ type: String, required: true, trim: true, name: 'guide_slug' })
  guideSlug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: Boolean, default: false })
  skipped: boolean;
}

export type VendorGuideProgressDocument =
  HydratedDocument<VendorGuideProgressModel>;

export const VendorGuideProgressSchema = SchemaFactory.createForClass(
  VendorGuideProgressModel,
);

VendorGuideProgressSchema.index({ userId: 1, guideSlug: 1, locale: 1 }, {
  unique: true,
});
