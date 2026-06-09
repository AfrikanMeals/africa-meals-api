import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AppPolicySectionModel } from '@schemas/app-policy.schema';
import {
  BlogArticleDocument,
  BlogArticleModel,
  BlogGroupDocument,
  BlogGroupModel,
  isValidBlogSlug,
  normalizeBlogSlug,
} from '@schemas/blog.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpsertBlogArticleDto } from './dto/upsert-blog-article.dto';
import { UpsertBlogGroupDto } from './dto/upsert-blog-group.dto';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeLocale(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 8) || 'fr';
}

function docTimestamps(doc: BlogGroupDocument | BlogArticleDocument) {
  const t = doc as typeof doc & { updatedAt?: Date; createdAt?: Date };
  return {
    updatedAt: t.updatedAt?.toISOString?.() ?? null,
    createdAt: t.createdAt?.toISOString?.() ?? null,
  };
}

function serializeSections(sections: AppPolicySectionModel[] | undefined) {
  return (sections ?? []).map((s) => ({
    title: s.title ?? '',
    imageUrl: s.imageUrl?.trim() || undefined,
    imageSize:
      s.imageSize === 'sm' ||
      s.imageSize === 'lg' ||
      s.imageSize === 'md' ||
      s.imageSize === 'xl'
        ? s.imageSize
        : undefined,
    htmlContent: s.htmlContent ?? '',
  }));
}

function serializeGroup(doc: BlogGroupDocument) {
  const { updatedAt, createdAt } = docTimestamps(doc);
  return {
    id: String(doc._id),
    slug: doc.slug,
    locale: doc.locale,
    title: doc.title,
    sortOrder: doc.sortOrder ?? 0,
    isPublished: Boolean(doc.isPublished),
    updatedAt,
    createdAt,
  };
}

function serializeArticle(doc: BlogArticleDocument, includeBody = false) {
  const { updatedAt, createdAt } = docTimestamps(doc);
  const base = {
    id: String(doc._id),
    slug: doc.slug,
    locale: doc.locale,
    groupSlug: doc.groupSlug,
    title: doc.title,
    description: doc.description ?? '',
    featuredImageUrl: resolveListingImageUrl(doc),
    sortOrder: doc.sortOrder ?? 0,
    isPublished: Boolean(doc.isPublished),
    updatedAt,
    createdAt,
  };
  if (!includeBody) return base;
  return { ...base, sections: serializeSections(doc.sections) };
}

function pickBySlugLocale<T extends { slug: string; locale: string }>(
  docs: T[],
  slug: string,
  locale: string,
): T | undefined {
  return (
    docs.find((d) => d.slug === slug && d.locale === locale) ??
    docs.find((d) => d.slug === slug && d.locale === 'fr')
  );
}

function uniqueSlugsSorted<
  T extends { slug: string; locale: string; sortOrder?: number },
>(docs: T[], locale: string): string[] {
  const slugs = [...new Set(docs.map((d) => d.slug))];
  return slugs.sort((a, b) => {
    const order = (slug: string) =>
      pickBySlugLocale(docs, slug, locale)?.sortOrder ?? 0;
    const diff = order(a) - order(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

/** Image à la une pour la liste : champ dédié, sinon 1ʳᵉ image de section. */
function resolveListingImageUrl(doc: BlogArticleDocument): string | undefined {
  const featured = doc.featuredImageUrl?.trim();
  if (featured) return featured;
  for (const section of doc.sections ?? []) {
    const url = section.imageUrl?.trim();
    if (url) return url;
  }
  return undefined;
}

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(BlogGroupModel.name)
    private readonly _groups: Model<BlogGroupDocument>,
    @InjectModel(BlogArticleModel.name)
    private readonly _articles: Model<BlogArticleDocument>,
  ) {}

  async listGroupsForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this._groups.find({}).sort({ sortOrder: 1, slug: 1 }).exec();
    return docs.map(serializeGroup);
  }

  async listArticlesForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this._articles
      .find({})
      .sort({ groupSlug: 1, sortOrder: 1, slug: 1 })
      .exec();
    return docs.map((d) => serializeArticle(d, true));
  }

  async upsertGroup(user: UserModel, dto: UpsertBlogGroupDto) {
    assertAdmin(user);
    const slug = normalizeBlogSlug(dto.slug);
    if (!isValidBlogSlug(slug)) {
      throw new BadRequestException('invalid_blog_group_slug');
    }
    const locale = normalizeLocale(dto.locale ?? 'fr');
    const doc = await this._groups
      .findOneAndUpdate(
        { slug, locale },
        {
          $set: {
            slug,
            locale,
            title: dto.title.trim(),
            sortOrder: dto.sortOrder ?? 0,
            isPublished: Boolean(dto.isPublished),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!doc) {
      throw new BadRequestException('blog_group_save_failed');
    }
    return serializeGroup(doc);
  }

  async upsertArticle(user: UserModel, dto: UpsertBlogArticleDto) {
    assertAdmin(user);
    const slug = normalizeBlogSlug(dto.slug);
    const groupSlug = normalizeBlogSlug(dto.groupSlug);
    if (!isValidBlogSlug(slug) || !isValidBlogSlug(groupSlug)) {
      throw new BadRequestException('invalid_blog_article_slug');
    }
    const locale = normalizeLocale(dto.locale ?? 'fr');
    const group = await this._groups.findOne({ slug: groupSlug, locale }).exec();
    if (!group) {
      throw new BadRequestException('blog_group_not_found');
    }
    const sections = (dto.sections ?? []).map((s) => ({
      title: s.title.trim(),
      imageUrl: s.imageUrl?.trim() || undefined,
      imageSize:
        s.imageSize === 'sm' ||
        s.imageSize === 'lg' ||
        s.imageSize === 'md' ||
        s.imageSize === 'xl'
          ? s.imageSize
          : undefined,
      htmlContent: s.htmlContent ?? '',
    }));
    const featuredImageUrl = dto.featuredImageUrl?.trim() || undefined;
    const doc = await this._articles
      .findOneAndUpdate(
        { slug, locale },
        {
          $set: {
            slug,
            locale,
            groupSlug,
            title: dto.title.trim(),
            description: dto.description?.trim() ?? '',
            featuredImageUrl,
            sections,
            sortOrder: dto.sortOrder ?? 0,
            isPublished: Boolean(dto.isPublished),
          },
          ...(featuredImageUrl ? {} : { $unset: { featuredImageUrl: '' } }),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!doc) {
      throw new BadRequestException('blog_article_save_failed');
    }
    return serializeArticle(doc, true);
  }

  async getPublicHub(localeRaw?: string) {
    const locale = normalizeLocale(localeRaw ?? 'fr');
    const [allGroups, articlesPublished] = await Promise.all([
      this._groups.find({}).sort({ sortOrder: 1, slug: 1 }).exec(),
      this._articles
        .find({ isPublished: true })
        .sort({ sortOrder: 1, title: 1, slug: 1 })
        .exec(),
    ]);

    const articles = uniqueSlugsSorted(articlesPublished, locale)
      .map((slug) => {
        const doc = pickBySlugLocale(articlesPublished, slug, locale);
        if (!doc?.title?.trim()) return null;
        const { updatedAt } = docTimestamps(doc);
        return {
          slug: doc.slug,
          groupSlug: doc.groupSlug,
          title: doc.title,
          description: doc.description ?? '',
          featuredImageUrl: resolveListingImageUrl(doc),
          sortOrder: doc.sortOrder ?? 0,
          updatedAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const groupSlugsWithArticles = new Set(articles.map((a) => a.groupSlug));

    const groups = uniqueSlugsSorted(
      allGroups.filter(
        (g) => g.isPublished || groupSlugsWithArticles.has(g.slug),
      ),
      locale,
    )
      .map((slug) => {
        const doc = pickBySlugLocale(allGroups, slug, locale);
        if (!doc?.title?.trim()) return null;
        return {
          slug: doc.slug,
          title: doc.title,
          sortOrder: doc.sortOrder ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return { locale, groups, articles };
  }

  async getPublishedArticle(slugRaw: string, localeRaw?: string) {
    const slug = normalizeBlogSlug(slugRaw);
    if (!isValidBlogSlug(slug)) {
      throw new NotFoundException('blog_article_not_found');
    }
    const locale = normalizeLocale(localeRaw ?? 'fr');
    let doc = await this._articles
      .findOne({ slug, locale, isPublished: true })
      .exec();
    if (!doc && locale !== 'fr') {
      doc = await this._articles
        .findOne({ slug, locale: 'fr', isPublished: true })
        .exec();
    }
    if (!doc) {
      throw new NotFoundException('blog_article_not_found');
    }
    return serializeArticle(doc, true);
  }
}
