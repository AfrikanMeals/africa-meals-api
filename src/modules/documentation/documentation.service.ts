import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DocumentationGroupDocument,
  DocumentationGroupModel,
  DocumentationSubjectDocument,
  DocumentationSubjectModel,
  DocumentationTopicDocument,
  DocumentationTopicModel,
  isValidDocSlug,
  normalizeDocSlug,
} from '@schemas/documentation.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpsertDocumentationGroupDto } from './dto/upsert-documentation-group.dto';
import { UpsertDocumentationSubjectDto } from './dto/upsert-documentation-subject.dto';
import { UpsertDocumentationTopicDto } from './dto/upsert-documentation-topic.dto';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeLocale(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 8) || 'fr';
}

function docTimestamps(
  doc:
    | DocumentationGroupDocument
    | DocumentationTopicDocument
    | DocumentationSubjectDocument,
) {
  const t = doc as typeof doc & { updatedAt?: Date; createdAt?: Date };
  return {
    updatedAt: t.updatedAt?.toISOString?.() ?? null,
    createdAt: t.createdAt?.toISOString?.() ?? null,
  };
}

function serializeGroup(doc: DocumentationGroupDocument) {
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

function serializeTopic(doc: DocumentationTopicDocument) {
  const { updatedAt, createdAt } = docTimestamps(doc);
  return {
    id: String(doc._id),
    slug: doc.slug,
    locale: doc.locale,
    groupSlug: doc.groupSlug,
    title: doc.title,
    summary: doc.summary ?? '',
    icon: doc.icon?.trim() || '',
    sortOrder: doc.sortOrder ?? 0,
    isPublished: Boolean(doc.isPublished),
    updatedAt,
    createdAt,
  };
}

function serializeSubject(
  doc: DocumentationSubjectDocument,
  includeBody = false,
) {
  const { updatedAt, createdAt } = docTimestamps(doc);
  const base = {
    id: String(doc._id),
    slug: doc.slug,
    locale: doc.locale,
    groupSlug: doc.groupSlug,
    topicSlug: doc.topicSlug,
    title: doc.title,
    summary: doc.summary ?? '',
    sortOrder: doc.sortOrder ?? 0,
    isPublished: Boolean(doc.isPublished),
    updatedAt,
    createdAt,
  };
  if (!includeBody) return base;
  return { ...base, htmlContent: doc.htmlContent ?? '' };
}

function pickLocaleDoc<T extends { locale: string; slug: string }>(
  docs: T[],
  locale: string,
): T | undefined {
  const slugs = [...new Set(docs.map((d) => d.slug))];
  for (const slug of slugs) {
    const match =
      docs.find((d) => d.slug === slug && d.locale === locale) ??
      docs.find((d) => d.slug === slug && d.locale === 'fr');
    if (match) return match;
  }
  return (
    docs.find((d) => d.locale === locale) ??
    docs.find((d) => d.locale === 'fr') ??
    docs[0]
  );
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

@Injectable()
export class DocumentationService {
  constructor(
    @InjectModel(DocumentationGroupModel.name)
    private readonly _groups: Model<DocumentationGroupDocument>,
    @InjectModel(DocumentationTopicModel.name)
    private readonly _topics: Model<DocumentationTopicDocument>,
    @InjectModel(DocumentationSubjectModel.name)
    private readonly _subjects: Model<DocumentationSubjectDocument>,
  ) {}

  async listGroupsForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this._groups.find({}).sort({ sortOrder: 1, slug: 1 }).exec();
    return docs.map(serializeGroup);
  }

  async listTopicsForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this._topics
      .find({})
      .sort({ groupSlug: 1, sortOrder: 1, slug: 1 })
      .exec();
    return docs.map(serializeTopic);
  }

  async listSubjectsForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this._subjects
      .find({})
      .sort({ topicSlug: 1, sortOrder: 1, slug: 1 })
      .exec();
    return docs.map((d) => serializeSubject(d, true));
  }

  async upsertGroup(user: UserModel, dto: UpsertDocumentationGroupDto) {
    assertAdmin(user);
    const slug = normalizeDocSlug(dto.slug);
    if (!isValidDocSlug(slug)) {
      throw new BadRequestException('invalid_documentation_group_slug');
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
      throw new BadRequestException('documentation_group_save_failed');
    }
    return serializeGroup(doc);
  }

  async deleteGroup(user: UserModel, slugRaw: string, localeRaw?: string) {
    assertAdmin(user);
    const slug = normalizeDocSlug(slugRaw);
    if (!isValidDocSlug(slug)) {
      throw new BadRequestException('invalid_documentation_group_slug');
    }
    const locale = normalizeLocale(localeRaw ?? 'fr');
    const doc = await this._groups.findOne({ slug, locale }).exec();
    if (!doc) {
      throw new NotFoundException('documentation_group_not_found');
    }
    const [topicCount, subjectCount] = await Promise.all([
      this._topics.countDocuments({ groupSlug: slug, locale }).exec(),
      this._subjects.countDocuments({ groupSlug: slug, locale }).exec(),
    ]);
    if (topicCount > 0 || subjectCount > 0) {
      throw new BadRequestException('documentation_group_has_children');
    }
    await doc.deleteOne();
    return { deleted: true, slug, locale };
  }

  async deleteTopic(user: UserModel, slugRaw: string, localeRaw?: string) {
    assertAdmin(user);
    const slug = normalizeDocSlug(slugRaw);
    if (!isValidDocSlug(slug)) {
      throw new BadRequestException('invalid_documentation_topic_slug');
    }
    const locale = normalizeLocale(localeRaw ?? 'fr');
    const doc = await this._topics.findOne({ slug, locale }).exec();
    if (!doc) {
      throw new NotFoundException('documentation_topic_not_found');
    }
    const subjectCount = await this._subjects
      .countDocuments({
        topicSlug: slug,
        groupSlug: doc.groupSlug,
        locale,
      })
      .exec();
    if (subjectCount > 0) {
      throw new BadRequestException('documentation_topic_has_subjects');
    }
    await doc.deleteOne();
    return { deleted: true, slug, locale };
  }

  async deleteSubject(user: UserModel, slugRaw: string, localeRaw?: string) {
    assertAdmin(user);
    const slug = normalizeDocSlug(slugRaw);
    if (!isValidDocSlug(slug)) {
      throw new BadRequestException('invalid_documentation_subject_slug');
    }
    const locale = normalizeLocale(localeRaw ?? 'fr');
    const doc = await this._subjects.findOne({ slug, locale }).exec();
    if (!doc) {
      throw new NotFoundException('documentation_subject_not_found');
    }
    await doc.deleteOne();
    return { deleted: true, slug, locale };
  }

  async upsertTopic(user: UserModel, dto: UpsertDocumentationTopicDto) {
    assertAdmin(user);
    const slug = normalizeDocSlug(dto.slug);
    const groupSlug = normalizeDocSlug(dto.groupSlug);
    if (!isValidDocSlug(slug) || !isValidDocSlug(groupSlug)) {
      throw new BadRequestException('invalid_documentation_topic_slug');
    }
    const locale = normalizeLocale(dto.locale ?? 'fr');
    const group = await this._groups.findOne({ slug: groupSlug, locale }).exec();
    if (!group) {
      throw new BadRequestException('documentation_group_not_found');
    }
    const doc = await this._topics
      .findOneAndUpdate(
        { slug, locale },
        {
          $set: {
            slug,
            locale,
            groupSlug,
            title: dto.title.trim(),
            summary: dto.summary?.trim() ?? '',
            icon: dto.icon?.trim() ?? '',
            sortOrder: dto.sortOrder ?? 0,
            isPublished: Boolean(dto.isPublished),
          },
          $unset: { htmlContent: '' },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!doc) {
      throw new BadRequestException('documentation_topic_save_failed');
    }
    return serializeTopic(doc);
  }

  async upsertSubject(user: UserModel, dto: UpsertDocumentationSubjectDto) {
    assertAdmin(user);
    const slug = normalizeDocSlug(dto.slug);
    const groupSlug = normalizeDocSlug(dto.groupSlug);
    const topicSlug = normalizeDocSlug(dto.topicSlug);
    if (
      !isValidDocSlug(slug) ||
      !isValidDocSlug(groupSlug) ||
      !isValidDocSlug(topicSlug)
    ) {
      throw new BadRequestException('invalid_documentation_subject_slug');
    }
    const locale = normalizeLocale(dto.locale ?? 'fr');
    const topic = await this._topics
      .findOne({ slug: topicSlug, groupSlug, locale })
      .exec();
    if (!topic) {
      throw new BadRequestException('documentation_topic_not_found');
    }
    const doc = await this._subjects
      .findOneAndUpdate(
        { slug, locale },
        {
          $set: {
            slug,
            locale,
            groupSlug,
            topicSlug,
            title: dto.title.trim(),
            summary: dto.summary?.trim() ?? '',
            htmlContent: dto.htmlContent ?? '',
            sortOrder: dto.sortOrder ?? 0,
            isPublished: Boolean(dto.isPublished),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    if (!doc) {
      throw new BadRequestException('documentation_subject_save_failed');
    }
    return serializeSubject(doc, true);
  }

  async getPublicHub(localeRaw?: string) {
    const locale = normalizeLocale(localeRaw ?? 'fr');
    const [groupsPublished, topicsPublished, subjectsPublished] =
      await Promise.all([
        this._groups
          .find({ isPublished: true })
          .sort({ sortOrder: 1, slug: 1 })
          .exec(),
        this._topics
          .find({ isPublished: true })
          .sort({ sortOrder: 1, title: 1, slug: 1 })
          .exec(),
        this._subjects
          .find({ isPublished: true })
          .sort({ sortOrder: 1, title: 1, slug: 1 })
          .exec(),
      ]);

    const groups = uniqueSlugsSorted(groupsPublished, locale)
      .map((slug) => {
        const doc = pickBySlugLocale(groupsPublished, slug, locale);
        if (!doc?.title?.trim()) return null;
        return {
          slug: doc.slug,
          title: doc.title,
          sortOrder: doc.sortOrder ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const groupSlugs = new Set(groups.map((g) => g.slug));

    const topics = uniqueSlugsSorted(topicsPublished, locale)
      .map((slug) => {
        const doc = pickBySlugLocale(topicsPublished, slug, locale);
        if (!doc?.title?.trim()) return null;
        if (!groupSlugs.has(doc.groupSlug)) return null;
        return {
          slug: doc.slug,
          groupSlug: doc.groupSlug,
          title: doc.title,
          summary: doc.summary ?? '',
          icon: doc.icon?.trim() || '',
          sortOrder: doc.sortOrder ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const topicKeys = new Set(
      topics.map((t) => `${t.groupSlug}:${t.slug}`),
    );

    const subjects = uniqueSlugsSorted(subjectsPublished, locale)
      .map((slug) => {
        const doc = pickBySlugLocale(subjectsPublished, slug, locale);
        if (!doc?.title?.trim()) return null;
        if (!groupSlugs.has(doc.groupSlug)) return null;
        if (!topicKeys.has(`${doc.groupSlug}:${doc.topicSlug}`)) return null;
        return {
          slug: doc.slug,
          groupSlug: doc.groupSlug,
          topicSlug: doc.topicSlug,
          title: doc.title,
          summary: doc.summary ?? '',
          sortOrder: doc.sortOrder ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return { locale, groups, topics, subjects };
  }

  async getPublishedTopic(slugRaw: string, localeRaw?: string) {
    const slug = normalizeDocSlug(slugRaw);
    if (!isValidDocSlug(slug)) {
      throw new NotFoundException('documentation_topic_not_found');
    }
    const locale = normalizeLocale(localeRaw ?? 'fr');
    let doc = await this._topics
      .findOne({ slug, locale, isPublished: true })
      .exec();
    if (!doc && locale !== 'fr') {
      doc = await this._topics
        .findOne({ slug, locale: 'fr', isPublished: true })
        .exec();
    }
    if (!doc) {
      throw new NotFoundException('documentation_topic_not_found');
    }

    const subjectsPublished = await this._subjects
      .find({
        topicSlug: doc.slug,
        groupSlug: doc.groupSlug,
        isPublished: true,
      })
      .sort({ sortOrder: 1, title: 1, slug: 1 })
      .exec();

    const subjectSlugs = uniqueSlugsSorted(subjectsPublished, locale);
    const subjects = subjectSlugs
      .map((sSlug) => {
        const sDoc = pickBySlugLocale(subjectsPublished, sSlug, locale);
        if (!sDoc?.title?.trim()) return null;
        return {
          slug: sDoc.slug,
          groupSlug: sDoc.groupSlug,
          topicSlug: sDoc.topicSlug,
          title: sDoc.title,
          summary: sDoc.summary ?? '',
          sortOrder: sDoc.sortOrder ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return {
      topic: serializeTopic(doc),
      subjects,
    };
  }

  async getPublishedSubject(slugRaw: string, localeRaw?: string) {
    const slug = normalizeDocSlug(slugRaw);
    if (!isValidDocSlug(slug)) {
      throw new NotFoundException('documentation_subject_not_found');
    }
    const locale = normalizeLocale(localeRaw ?? 'fr');
    let doc = await this._subjects
      .findOne({ slug, locale, isPublished: true })
      .exec();
    if (!doc && locale !== 'fr') {
      doc = await this._subjects
        .findOne({ slug, locale: 'fr', isPublished: true })
        .exec();
    }
    if (!doc) {
      throw new NotFoundException('documentation_subject_not_found');
    }
    return serializeSubject(doc, true);
  }
}
