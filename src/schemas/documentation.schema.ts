import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const DOC_SLUG_REGEX = /^[a-z][a-z0-9-]{0,63}$/;

export function normalizeDocSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, '-');
}

export function isValidDocSlug(slug: string): boolean {
  return DOC_SLUG_REGEX.test(slug);
}

/** Onglet documentation (ex. Restaurants, Magasins). */
@Schema({ timestamps: true, collection: 'documentation_groups' })
export class DocumentationGroupModel {
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

export type DocumentationGroupDocument =
  HydratedDocument<DocumentationGroupModel>;

export const DocumentationGroupSchema = SchemaFactory.createForClass(
  DocumentationGroupModel,
);

DocumentationGroupSchema.index({ slug: 1, locale: 1 }, { unique: true });

/** Catégorie d’aide rattachée à un groupe. */
@Schema({ timestamps: true, collection: 'documentation_topics' })
export class DocumentationTopicModel {
  @Prop({ type: String, required: true, trim: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  groupSlug: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '' })
  summary: string;

  /** Classe Hugeicons (ex. hgi-shopping-bag-01). */
  @Prop({ type: String, default: '', trim: true })
  icon: string;

  @Prop({ type: Number, default: 0, name: 'sort_order' })
  sortOrder: number;

  @Prop({ type: Boolean, default: false, name: 'is_published' })
  isPublished: boolean;
}

export type DocumentationTopicDocument =
  HydratedDocument<DocumentationTopicModel>;

export const DocumentationTopicSchema = SchemaFactory.createForClass(
  DocumentationTopicModel,
);

DocumentationTopicSchema.index({ slug: 1, locale: 1 }, { unique: true });
DocumentationTopicSchema.index({ groupSlug: 1, locale: 1, sortOrder: 1 });

/** Article de documentation rattaché à un topic. */
@Schema({ timestamps: true, collection: 'documentation_subjects' })
export class DocumentationSubjectModel {
  @Prop({ type: String, required: true, trim: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  groupSlug: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  topicSlug: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '' })
  summary: string;

  @Prop({ type: String, default: '' })
  htmlContent: string;

  @Prop({ type: Number, default: 0, name: 'sort_order' })
  sortOrder: number;

  @Prop({ type: Boolean, default: false, name: 'is_published' })
  isPublished: boolean;
}

export type DocumentationSubjectDocument =
  HydratedDocument<DocumentationSubjectModel>;

export const DocumentationSubjectSchema = SchemaFactory.createForClass(
  DocumentationSubjectModel,
);

DocumentationSubjectSchema.index({ slug: 1, locale: 1 }, { unique: true });
DocumentationSubjectSchema.index({ topicSlug: 1, locale: 1, sortOrder: 1 });
