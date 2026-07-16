import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  isValidSitePageSlug,
  normalizeSitePageSlug,
  SitePageDocument,
  SitePageModel,
} from '@schemas/site-page.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpsertSitePageDto } from './dto/upsert-site-page.dto';
import {
  normalizeSitePageLocale,
  normalizeVendorContent,
  pickSitePageByLocale,
  serializeSitePage,
} from './site-pages.util';
import { vendorSitePageSeeds } from './vendor-site-page.seed';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class SitePagesService implements OnModuleInit {
  private readonly _logger = new Logger(SitePagesService.name);

  constructor(
    @InjectModel(SitePageModel.name)
    private readonly _pages: Model<SitePageDocument>,
  ) {}

  onModuleInit(): void {
    // Seed idempotent en arrière-plan — ne bloque pas le boot Nest.
    void this.seedVendorPagesIfMissing();
  }

  /** Upsert uniquement si (slug, locale) absent — ne réécrit jamais un doc édité. */
  async seedVendorPagesIfMissing(): Promise<void> {
    try {
      for (const seed of vendorSitePageSeeds()) {
        const existing = await this._pages
          .findOne({ slug: seed.slug, locale: seed.locale })
          .select('_id')
          .lean()
          .exec();
        if (existing) continue;
        await this._pages.create({
          slug: seed.slug,
          locale: seed.locale,
          title: seed.title,
          metaTitle: seed.metaTitle,
          metaDescription: seed.metaDescription,
          content: seed.content,
          isPublished: seed.isPublished,
        });
        this._logger.log(
          `site_pages seed: ${seed.slug}/${seed.locale} créé`,
        );
      }
    } catch (err) {
      this._logger.warn(
        `site_pages seed échoué: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this._pages
      .find({})
      .sort({ slug: 1, locale: 1 })
      .exec();
    return docs.map((d) => serializeSitePage(d));
  }

  async getForAdmin(user: UserModel, slugRaw: string, localeRaw: string) {
    assertAdmin(user);
    const slug = normalizeSitePageSlug(slugRaw);
    if (!isValidSitePageSlug(slug)) {
      throw new BadRequestException('invalid_site_page_slug');
    }
    const locale = normalizeSitePageLocale(localeRaw);
    const doc = await this._pages.findOne({ slug, locale }).exec();
    if (!doc) {
      return {
        slug,
        locale,
        title: '',
        metaTitle: '',
        metaDescription: '',
        content: normalizeVendorContent({}),
        isPublished: false,
        updatedAt: null,
        createdAt: null,
      };
    }
    return serializeSitePage(doc);
  }

  async upsert(user: UserModel, slugRaw: string, dto: UpsertSitePageDto) {
    assertAdmin(user);
    const slug = normalizeSitePageSlug(slugRaw || dto.slug);
    if (!isValidSitePageSlug(slug)) {
      throw new BadRequestException('invalid_site_page_slug');
    }
    // Cohérence path / body : le slug URL fait foi.
    if (normalizeSitePageSlug(dto.slug) !== slug) {
      throw new BadRequestException('slug_mismatch');
    }
    const locale = normalizeSitePageLocale(dto.locale);
    const content = normalizeVendorContent(dto.content);

    const doc = await this._pages
      .findOneAndUpdate(
        { slug, locale },
        {
          $set: {
            slug,
            locale,
            title: dto.title.trim(),
            metaTitle: dto.metaTitle?.trim() ?? '',
            metaDescription: dto.metaDescription?.trim() ?? '',
            content,
            isPublished: Boolean(dto.isPublished),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!doc) {
      throw new BadRequestException('site_page_save_failed');
    }
    return serializeSitePage(doc);
  }

  /**
   * Page publiée pour le site vitrine.
   * Fallback locale FR si EN absent (comme policies).
   */
  async getPublishedPublic(slugRaw: string, localeRaw?: string) {
    const slug = normalizeSitePageSlug(slugRaw);
    if (!isValidSitePageSlug(slug)) {
      throw new BadRequestException('invalid_site_page_slug');
    }
    const locale = normalizeSitePageLocale(localeRaw);
    const published = await this._pages
      .find({ slug, isPublished: true })
      .exec();
    const doc = pickSitePageByLocale(published, slug, locale);
    if (!doc) {
      throw new NotFoundException('site_page_not_found');
    }
    const localeFallback = doc.locale !== locale;
    return serializeSitePage(doc, { localeFallback });
  }
}
