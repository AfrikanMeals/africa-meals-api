import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

/** Slugs marketing web (namespace séparé de app_policies). */
export const SITE_PAGE_SLUGS = ['vendor'] as const;

export const SITE_PAGE_SLUG_REGEX = /^[a-z][a-z0-9-]{0,63}$/;

export function normalizeSitePageSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/_/g, '-');
}

export function isValidSitePageSlug(slug: string): boolean {
  return SITE_PAGE_SLUG_REGEX.test(slug);
}

/**
 * Contenu structuré d’une landing marketing (ex. /vendor).
 * Mixed : blocs typés côté DTO / seed, schéma flexible pour évolutions.
 */
@Schema({ timestamps: true, collection: 'site_pages' })
export class SitePageModel {
  @Prop({ type: String, required: true, trim: true, index: true })
  slug: string;

  @Prop({ type: String, required: true, trim: true, default: 'fr' })
  locale: string;

  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, required: false, default: '' })
  metaTitle: string;

  @Prop({ type: String, required: false, default: '' })
  metaDescription: string;

  /** Blocs hero / FAQ / tools… — shape validée par UpsertSitePageDto. */
  @Prop({ type: SchemaTypes.Mixed, required: true, default: {} })
  content: Record<string, unknown>;

  @Prop({ type: Boolean, default: false, name: 'is_published' })
  isPublished: boolean;
}

export type SitePageDocument = HydratedDocument<SitePageModel>;

export const SitePageSchema = SchemaFactory.createForClass(SitePageModel);

SitePageSchema.index({ slug: 1, locale: 1 }, { unique: true });
