import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const APP_POLICY_SLUGS = ['privacy', 'terms'] as const;
export type AppPolicySlug = (typeof APP_POLICY_SLUGS)[number];

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
