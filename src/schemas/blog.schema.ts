import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  AppPolicySectionModel,
  AppPolicySectionSchema,
} from '@schemas/app-policy.schema';

export {
  DOC_SLUG_REGEX as BLOG_SLUG_REGEX,
  isValidDocSlug as isValidBlogSlug,
  normalizeDocSlug as normalizeBlogSlug,
} from '@schemas/documentation.schema';

/** Catégorie principale du blog (ex. Actualités, Conseils). */
@Schema({ timestamps: true, collection: 'blog_groups' })
export class BlogGroupModel {
  @Prop({ type: String, required: true, trim: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: Number, default: 0, name: 'sort_order' })
  sortOrder: number;

  @Prop({ type: Boolean, default: false, name: 'is_published' })
  isPublished: boolean;
}

export type BlogGroupDocument = HydratedDocument<BlogGroupModel>;

export const BlogGroupSchema = SchemaFactory.createForClass(BlogGroupModel);

BlogGroupSchema.index({ slug: 1, locale: 1 }, { unique: true });

/** Article de blog rattaché à un groupe. */
@Schema({ timestamps: true, collection: 'blog_articles' })
export class BlogArticleModel {
  @Prop({ type: String, required: true, trim: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  groupSlug: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '' })
  description: string;

  /** Image à la une (liste + en-tête article). */
  @Prop({ type: String, required: false, trim: true, name: 'featured_image_url' })
  featuredImageUrl?: string;

  @Prop({ type: [AppPolicySectionSchema], default: [] })
  sections: AppPolicySectionModel[];

  @Prop({ type: Number, default: 0, name: 'sort_order' })
  sortOrder: number;

  @Prop({ type: Boolean, default: false, name: 'is_published' })
  isPublished: boolean;
}

export type BlogArticleDocument = HydratedDocument<BlogArticleModel>;

export const BlogArticleSchema = SchemaFactory.createForClass(BlogArticleModel);

BlogArticleSchema.index({ slug: 1, locale: 1 }, { unique: true });
BlogArticleSchema.index({ groupSlug: 1, locale: 1, sortOrder: 1 });
