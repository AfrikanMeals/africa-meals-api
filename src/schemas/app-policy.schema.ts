import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Slugs suggérés (le CMS accepte tout identifiant valide). */
export const BUILTIN_POLICY_SLUGS = [
  'privacy',
  'terms',
  'refund',
  'shipping',
] as const;

export const POLICY_SLUG_REGEX = /^[a-z][a-z0-9-]{0,63}$/;

export function normalizePolicySlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, '-');
}

export function isValidPolicySlug(slug: string): boolean {
  return POLICY_SLUG_REGEX.test(slug);
}

@Schema({ _id: false })
export class AppPolicySectionModel {
  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: false, trim: true })
  imageUrl?: string;

  @Prop({ type: String, required: true, default: '' })
  htmlContent: string;
}

export const AppPolicySectionSchema = SchemaFactory.createForClass(
  AppPolicySectionModel,
);

/** Pages légales / politiques (confidentialité, CGU, etc.). */
@Schema({ timestamps: true, collection: 'app_policies' })
export class AppPolicyModel {
  @Prop({ type: String, required: true, trim: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: true, default: '' })
  description: string;

  @Prop({ type: [AppPolicySectionSchema], default: [] })
  sections: AppPolicySectionModel[];

  @Prop({ type: Boolean, default: false, name: 'is_published' })
  isPublished: boolean;
}

export type AppPolicyDocument = HydratedDocument<AppPolicyModel>;

export const AppPolicySchema = SchemaFactory.createForClass(AppPolicyModel);

AppPolicySchema.index({ slug: 1, locale: 1 }, { unique: true });
