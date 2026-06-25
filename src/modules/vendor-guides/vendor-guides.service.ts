import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  isValidVendorGuideSlug,
  normalizeVendorGuideSlug,
  VendorGuideActionTypeEnum,
  VendorGuideArticleDocument,
  VendorGuideArticleModel,
  VendorGuideProgressDocument,
  VendorGuideProgressModel,
  VendorGuideSettingsDocument,
  VendorGuideSettingsModel,
} from '@schemas/vendor-guide.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import {
  DismissVendorGuidesDto,
  UpdateVendorGuideSettingsDto,
  UpsertVendorGuideDto,
} from './dto/vendor-guide.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeLocale(raw: string | undefined): string {
  return raw?.trim().toLowerCase().slice(0, 8) || 'fr';
}

function docTimestamps(doc: { updatedAt?: Date; createdAt?: Date }) {
  return {
    updatedAt: doc.updatedAt?.toISOString?.() ?? null,
    createdAt: doc.createdAt?.toISOString?.() ?? null,
  };
}

function serializeGuide(doc: VendorGuideArticleDocument) {
  const typed = doc as VendorGuideArticleDocument & {
    updatedAt?: Date;
    createdAt?: Date;
  };
  const updatedAt = typed.updatedAt?.toISOString?.() ?? null;
  const createdAt = typed.createdAt?.toISOString?.() ?? null;
  return {
    id: String(doc._id),
    slug: doc.slug,
    locale: doc.locale,
    title: doc.title,
    imageUrl: doc.imageUrl?.trim() || '',
    htmlContent: doc.htmlContent ?? '',
    actionType: doc.actionType ?? VendorGuideActionTypeEnum.NONE,
    actionLabel: doc.actionLabel?.trim() || '',
    actionTarget: doc.actionTarget?.trim() || '',
    sortOrder: doc.sortOrder ?? 0,
    isActive: Boolean(doc.isActive),
    updatedAt,
    createdAt,
  };
}

function daysSince(date: Date | undefined | null): number {
  if (!date) return 0;
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

function guideProgressKey(slug: string, locale: string): string {
  return `${slug}::${normalizeLocale(locale)}`;
}

function isDisplayableGuide(doc: VendorGuideArticleDocument): boolean {
  const title = doc.title?.trim() ?? '';
  if (!title) return false;
  const html = doc.htmlContent?.trim() ?? '';
  const image = doc.imageUrl?.trim() ?? '';
  return Boolean(html || image);
}

function isGuideProgressBlocking(
  record: {
    guideSlug?: string;
    locale?: string;
    updatedAt?: Date;
    createdAt?: Date;
  },
  redisplayAfterDays: number,
): boolean {
  const slug = String(record.guideSlug ?? '').trim();
  if (!slug) return false;
  if (redisplayAfterDays <= 0) return true;
  const lastShownAt = record.updatedAt ?? record.createdAt;
  return daysSince(lastShownAt) < redisplayAfterDays;
}

@Injectable()
export class VendorGuidesService {
  constructor(
    @InjectModel(VendorGuideArticleModel.name)
    private readonly guides: Model<VendorGuideArticleDocument>,
    @InjectModel(VendorGuideSettingsModel.name)
    private readonly settings: Model<VendorGuideSettingsDocument>,
    @InjectModel(VendorGuideProgressModel.name)
    private readonly progress: Model<VendorGuideProgressDocument>,
    @InjectModel(StoreModel.name)
    private readonly stores: Model<StoreModel>,
    private readonly storeAccess: StoreAccessService,
  ) {}

  private async getSettingsDoc() {
    return this.settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            sendAfterDays: 0,
            articlesPerBatch: 3,
            redisplayAfterDays: 0,
            isEnabled: true,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  private serializeSettings(doc: VendorGuideSettingsModel) {
    const typed = doc as VendorGuideSettingsModel & {
      updatedAt?: Date;
      createdAt?: Date;
    };
    const { updatedAt, createdAt } = docTimestamps(typed);
    return {
      sendAfterDays: Math.max(0, Number(doc.sendAfterDays ?? 0)),
      articlesPerBatch: Math.min(
        20,
        Math.max(1, Number(doc.articlesPerBatch ?? 3)),
      ),
      redisplayAfterDays: Math.max(0, Number(doc.redisplayAfterDays ?? 0)),
      isEnabled: doc.isEnabled !== false,
      updatedAt,
      createdAt,
    };
  }

  async listGuidesForAdmin(user: UserModel) {
    assertAdmin(user);
    const docs = await this.guides.find().sort({ locale: 1, sortOrder: 1 }).exec();
    return docs.map((d) => serializeGuide(d));
  }

  async getSettingsForAdmin(user: UserModel) {
    assertAdmin(user);
    const doc = await this.getSettingsDoc();
    return this.serializeSettings(doc as VendorGuideSettingsModel);
  }

  async upsertGuide(user: UserModel, dto: UpsertVendorGuideDto) {
    assertAdmin(user);
    const slug = normalizeVendorGuideSlug(dto.slug);
    if (!isValidVendorGuideSlug(slug)) {
      throw new BadRequestException('invalid_slug');
    }
    const locale = normalizeLocale(dto.locale);
    const actionType = dto.actionType ?? VendorGuideActionTypeEnum.NONE;
    const actionTarget = String(dto.actionTarget ?? '').trim();
    if (actionType === VendorGuideActionTypeEnum.LINK && !actionTarget) {
      throw new BadRequestException('action_target_required_for_link');
    }
    if (actionType === VendorGuideActionTypeEnum.ROUTE && !actionTarget) {
      throw new BadRequestException('action_target_required_for_route');
    }

    const updated = await this.guides
      .findOneAndUpdate(
        { slug, locale },
        {
          $set: {
            slug,
            locale,
            title: String(dto.title ?? '').trim(),
            imageUrl: String(dto.imageUrl ?? '').trim(),
            htmlContent: dto.htmlContent ?? '',
            actionType,
            actionLabel: String(dto.actionLabel ?? '').trim(),
            actionTarget,
            sortOrder: Number(dto.sortOrder ?? 0),
            isActive: dto.isActive === true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return serializeGuide(updated);
  }

  async updateSettings(user: UserModel, dto: UpdateVendorGuideSettingsDto) {
    assertAdmin(user);
    const patch: Record<string, unknown> = {};
    if (dto.sendAfterDays != null) patch.sendAfterDays = dto.sendAfterDays;
    if (dto.articlesPerBatch != null) patch.articlesPerBatch = dto.articlesPerBatch;
    if (dto.redisplayAfterDays != null) {
      patch.redisplayAfterDays = dto.redisplayAfterDays;
    }
    if (dto.isEnabled != null) patch.isEnabled = dto.isEnabled;

    const updated = await this.settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: patch, $setOnInsert: { key: SETTINGS_KEY } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.serializeSettings(updated);
  }

  async deleteGuide(user: UserModel, slug: string, locale?: string) {
    assertAdmin(user);
    const normalized = normalizeVendorGuideSlug(slug);
    const loc = normalizeLocale(locale);
    const deleted = await this.guides
      .findOneAndDelete({ slug: normalized, locale: loc })
      .exec();
    if (!deleted) throw new NotFoundException('guide_not_found');
    await this.progress.deleteMany({ guideSlug: normalized, locale: loc }).exec();
    return { ok: true };
  }

  private async resolveOwnerStore(user: UserModel, storeId?: string) {
    const access = await this.storeAccess.resolveStoreAccess(user);
    const owned = access.filter((row) => row.isOwner === true);
    if (owned.length === 0) {
      throw new ForbiddenException('store_owner_only');
    }
    const sid = storeId?.trim() || owned[0]?.storeId;
    const row = owned.find((r) => r.storeId === sid);
    if (!row) {
      throw new ForbiddenException('store_owner_only');
    }
    const store = await this.stores.findById(sid).lean().exec();
    if (!store) throw new NotFoundException('store_not_found');
    return { storeId: sid, storeCreatedAt: store.createdAt as Date | undefined };
  }

  async getPendingForVendor(
    user: UserModel,
    args: { locale?: string; storeId?: string },
  ) {
    const { storeCreatedAt } = await this.resolveOwnerStore(user, args.storeId);
    const settingsDoc = await this.getSettingsDoc();
    const settings = this.serializeSettings(
      settingsDoc as VendorGuideSettingsModel,
    );
    if (!settings.isEnabled) {
      return { settings, guides: [] as ReturnType<typeof serializeGuide>[] };
    }

    const elapsedDays = daysSince(storeCreatedAt);
    if (elapsedDays < settings.sendAfterDays) {
      return { settings, guides: [] as ReturnType<typeof serializeGuide>[] };
    }

    const locale = normalizeLocale(args.locale);
    const userId = String(user._id);
    const progressRecords = await this.progress
      .find({ userId })
      .select('guideSlug locale updatedAt createdAt')
      .lean()
      .exec();

    const blockedGuideKeys = new Set<string>();
    for (const record of progressRecords) {
      const slug = String(record.guideSlug ?? '').trim();
      if (!slug) continue;
      if (
        isGuideProgressBlocking(
          record as {
            guideSlug?: string;
            locale?: string;
            updatedAt?: Date;
            createdAt?: Date;
          },
          settings.redisplayAfterDays,
        )
      ) {
        blockedGuideKeys.add(
          guideProgressKey(slug, String(record.locale ?? 'fr')),
        );
      }
    }

    const localeOrder =
      locale === 'en' ? (['en', 'fr'] as const) : ([locale, 'en'] as const);
    const candidates: VendorGuideArticleDocument[] = [];
    const usedSlugs = new Set<string>();

    for (const loc of localeOrder) {
      if (candidates.length >= settings.articlesPerBatch) break;
      const batch = await this.guides
        .find({
          locale: loc,
          isActive: true,
          slug: { $nin: [...usedSlugs] },
        })
        .sort({ sortOrder: 1, createdAt: 1 })
        .exec();
      for (const doc of batch) {
        if (candidates.length >= settings.articlesPerBatch) break;
        if (
          blockedGuideKeys.has(
            guideProgressKey(doc.slug, String(doc.locale ?? loc)),
          )
        ) {
          continue;
        }
        if (!isDisplayableGuide(doc)) continue;
        usedSlugs.add(doc.slug);
        candidates.push(doc);
      }
    }

    return {
      settings,
      guides: candidates.map((d) => {
        const base = serializeGuide(d);
        return {
          id: base.id,
          slug: base.slug,
          locale: base.locale,
          title: base.title,
          imageUrl: base.imageUrl,
          htmlContent: base.htmlContent,
          actionType: base.actionType,
          actionLabel: base.actionLabel,
          actionTarget: base.actionTarget,
          sortOrder: base.sortOrder,
        };
      }),
    };
  }

  async dismissForVendor(user: UserModel, dto: DismissVendorGuidesDto) {
    await this.resolveOwnerStore(user);
    const locale = normalizeLocale(dto.locale);
    const userId = String(user._id);
    const slugs = [...new Set(dto.guideSlugs.map((s) => normalizeVendorGuideSlug(s)))];
    if (slugs.length === 0) return { ok: true, dismissed: 0 };

    const ops = slugs.map((guideSlug) => ({
      updateOne: {
        filter: { userId, guideSlug, locale },
        update: {
          $set: {
            userId,
            guideSlug,
            locale,
            skipped: dto.skipped === true,
          },
          $currentDate: { updatedAt: true },
        },
        upsert: true,
      },
    }));
    await this.progress.bulkWrite(ops);
    return { ok: true, dismissed: slugs.length };
  }
}
