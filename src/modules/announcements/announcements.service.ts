import { MediasService } from '@modules/medias/medias.service';
import {
  AppCacheKeys,
  apiPublicCacheTtlMs,
} from '@common/redis-app-cache';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  AnnouncementAudienceTypeEnum,
  AnnouncementPlacementEnum,
} from '@schemas/announcement.constants';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AnnouncementDismissalDocument,
  AnnouncementDismissalModel,
} from '@schemas/announcement-dismissal.schema';
import {
  AnnouncementModel,
  AnnouncementNavigationTypeEnum,
} from '@schemas/announcement.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { FilterQuery, Model, Types } from 'mongoose';
import { Error as MongooseError } from 'mongoose';
import { StoreAdActionTypeEnum } from '@schemas/ad.schema';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';
import { AnnouncementImageJsonDto } from './dto/announcement-image.dto';
import { applyAnnouncementPictureUrl } from './announcement-picture-url.util';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('not_allowed');
  }
}

function resolveUserAudience(user: UserModel): AnnouncementAudienceTypeEnum {
  switch (user.type) {
    case UserTypeEnum.ADMIN:
      return AnnouncementAudienceTypeEnum.VENDOR;
    case UserTypeEnum.DELIVERY:
      return AnnouncementAudienceTypeEnum.COURIER;
    case UserTypeEnum.VENDOR:
      return AnnouncementAudienceTypeEnum.VENDOR;
    default:
      return AnnouncementAudienceTypeEnum.CUSTOMER;
  }
}

function isWithinSchedule(doc: {
  validFrom?: Date | null;
  validUntil?: Date | null;
}): boolean {
  const now = Date.now();
  if (doc.validFrom && doc.validFrom.getTime() > now) return false;
  if (doc.validUntil && doc.validUntil.getTime() < now) return false;
  return true;
}

function defaultActionText(actionType?: StoreAdActionTypeEnum): string {
  switch (actionType) {
    case StoreAdActionTypeEnum.CALL:
      return 'Appeler';
    case StoreAdActionTypeEnum.WHATSAPP:
      return 'WhatsApp';
    case StoreAdActionTypeEnum.EMAIL:
      return 'E-mail';
    case StoreAdActionTypeEnum.SHOP:
      return 'Voir la boutique';
    case StoreAdActionTypeEnum.PRODUCT:
      return 'Voir le plat';
    default:
      return 'En savoir plus';
  }
}

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);
  @InjectModel(AnnouncementModel.name)
  private readonly _announcementModel: Model<AnnouncementModel>;

  @InjectModel(AnnouncementDismissalModel.name)
  private readonly _dismissalModel: Model<AnnouncementDismissalDocument>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  async listForUser(args: {
    user: UserModel;
    placement?: AnnouncementPlacementEnum;
    regionCode?: string;
  }) {
    const audience = resolveUserAudience(args.user);
    const region = String(args.regionCode ?? userRegion(args.user))
      .trim()
      .toUpperCase()
      .slice(0, 2);
    const dismissed = await this._dismissedIdsForUser(args.user._id.toString());
    const filter: FilterQuery<AnnouncementModel> = {
      isActive: true,
      ...(args.placement ? { placements: args.placement } : {}),
    };
    if (region) {
      filter.$or = [{ region: { $exists: false } }, { region: null }, { region: '' }, { region }];
    }
    const docs = await this._announcementModel
      .find(filter)
      .sort({ sortOrder: 1, updatedAt: -1 })
      .limit(80)
      .lean()
      .exec();
    return this._resolveDocsPictureUrls(
      docs.filter((doc) => {
        const id = String(doc._id ?? '');
        if (dismissed.has(id)) return false;
        if (!isWithinSchedule(doc)) return false;
        return this._matchesAudience(doc, audience, args.user._id.toString());
      }),
    );
  }

  /** Liste publique legacy (shop home) — client home before ads. */
  async list() {
    return this._cacheLayer.getOrSet(
      'publicCatalog',
      AppCacheKeys.announcements,
      apiPublicCacheTtlMs(),
      async () => {
        const now = new Date();
        const docs = await this._announcementModel
          .find({
            isActive: true,
            placements: AnnouncementPlacementEnum.CUSTOMER_HOME_BEFORE_ADS,
            $and: [
              {
                $or: [
                  { validFrom: { $exists: false } },
                  { validFrom: null },
                  { validFrom: { $lte: now } },
                ],
              },
              {
                $or: [
                  { validUntil: { $exists: false } },
                  { validUntil: null },
                  { validUntil: { $gte: now } },
                ],
              },
            ],
          })
          .sort({ sortOrder: 1, updatedAt: -1 })
          .limit(40)
          .lean()
          .exec();
        const filtered = docs.filter((doc) =>
          this._matchesAudience(doc, AnnouncementAudienceTypeEnum.CUSTOMER, ''),
        );
        return this._resolveDocsPictureUrls(filtered);
      },
    );
  }

  async listManage(user: UserModel) {
    assertAdmin(user);
    const docs = await this._announcementModel
      .find({})
      .sort({ sortOrder: 1, updatedAt: -1 })
      .lean()
      .exec();
    // Comme les bannières : résoudre l’URL publique à la lecture (proxy / signed).
    return this._resolveDocsPictureUrls(docs);
  }

  async create(
    args: CreateAnnouncementDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    assertAdmin(user);
    const payload = await this._buildPayload(args, user, image);
    let created: AnnouncementModel;
    try {
      created = await this._announcementModel.create(payload);
    } catch (err) {
      if (err instanceof MongooseError.ValidationError) {
        throw new BadRequestException(err.message);
      }
      this.logger.error(
        `announcement create failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
    await this._bustAnnouncementsCache();
    const doc = await this._announcementModel.findById(created._id).lean().exec();
    if (!doc) throw new NotFoundException('announcement_not_found');
    return this._resolveDocPictureUrl(doc);
  }

  async update(
    id: string,
    args: UpdateAnnouncementDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    assertAdmin(user);
    const payload = await this._buildPayload(args, user, image);
    try {
      await this._announcementModel.updateOne({ _id: id }, { $set: payload });
    } catch (err) {
      if (err instanceof MongooseError.ValidationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    await this._bustAnnouncementsCache();
    const doc = await this._announcementModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException('announcement_not_found');
    return this._resolveDocPictureUrl(doc);
  }

  async remove(id: string, user: UserModel) {
    assertAdmin(user);
    await this._announcementModel.deleteOne({ _id: id });
    await this._dismissalModel.deleteMany({ announcementId: id });
    await this._bustAnnouncementsCache();
    return { ok: true };
  }

  async dismiss(id: string, user: UserModel) {
    await this._dismissalModel.updateOne(
      { userId: user._id, announcementId: id },
      { $set: { dismissedAt: new Date() } },
      { upsert: true },
    );
    return { ok: true };
  }

  /** Même destination Storage que multipart ; corps JSON pour proxys qui coupent multipart. */
  async uploadAnnouncementImageJson(
    user: UserModel,
    dto: AnnouncementImageJsonDto,
  ): Promise<{ url: string }> {
    assertAdmin(user);
    const raw = dto.imageBase64
      .replace(/\s/g, '')
      .replace(/^data:image\/[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_image');
    }
    const max = await this._mediasService.getMaxFileSizeBytes();
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (dto.filename || 'announcement.jpg').trim() || 'announcement.jpg';
    if (!/\.(jpe?g|png|webp)$/i.test(name)) {
      throw new BadRequestException('invalid_file_type');
    }
    const lower = name.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    const file = {
      fieldname: 'image',
      originalname: name,
      encoding: '7bit',
      mimetype: mime,
      buffer,
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: undefined,
    } as Express.Multer.File;
    const url = await this._mediasService.upload(file, user, 'announcements');
    const resolved =
      (await this._mediasService.resolvePublicMediaUrl(url)) ?? url;
    return { url: resolved };
  }

  private _normalizeHexColor(raw?: string): string | undefined {
    const value = String(raw ?? '').trim();
    if (!value) return undefined;
    if (
      /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value)
    ) {
      return value.toUpperCase();
    }
    return undefined;
  }

  private async _buildPayload(
    args: CreateAnnouncementDto | UpdateAnnouncementDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    const payload: Record<string, unknown> = {
      isActive: args.isActive,
      text: String(args.text ?? '').trim(),
      subtitle: String(args.subtitle ?? '').trim(),
      actionText:
        String(args.actionText ?? '').trim() ||
        defaultActionText(args.actionType),
      sortOrder: Number.isFinite(Number(args.sortOrder))
        ? Number(args.sortOrder)
        : 0,
      region: args.region?.trim().toUpperCase().slice(0, 2) || undefined,
      validFrom: args.validFrom ? new Date(args.validFrom) : undefined,
      validUntil: args.validUntil ? new Date(args.validUntil) : undefined,
      audienceType: args.audienceType ?? AnnouncementAudienceTypeEnum.ALL,
      audienceUserIds: (args.audienceUserIds ?? []).map(
        (uid) => new Types.ObjectId(uid),
      ),
      placements: args.placements ?? [],
      actionType: args.actionType,
      actionTarget: args.actionTarget?.trim(),
      dismissible: args.dismissible !== false,
    };
    if (args.backgroundColor !== undefined) {
      payload.backgroundColor = this._normalizeHexColor(args.backgroundColor);
    }
    if (args.textColor !== undefined) {
      payload.textColor = this._normalizeHexColor(args.textColor);
    }
    if (args.storeId) payload.store = new Types.ObjectId(args.storeId);
    if (args.productId) payload.product = new Types.ObjectId(args.productId);
    if (args.config) {
      const cfg = { ...args.config };
      if (
        cfg.navigationType === AnnouncementNavigationTypeEnum.INTERNAL &&
        cfg.query?.searchContent
      ) {
        cfg.url = `search?searchContent=${cfg.query.searchContent}&storeId=${cfg.query.storeId ?? ''}&categoryId=${cfg.query.categoryId ?? ''}&productId=${cfg.query.producId ?? ''}&minPrice=0&sortBy=createdAt&sortDirection=desc`;
      }
      payload.config = cfg;
    }
    if (image) {
      payload.pictureUrl = await this._mediasService.upload(
        image,
        user,
        'announcements',
      );
    } else if (args.pictureUrl !== undefined) {
      // null / '' → effacer l’image ; sinon persister l’URL uploadée (image-json).
      const next = applyAnnouncementPictureUrl(args.pictureUrl);
      payload.pictureUrl = next;
    }
    return payload;
  }

  /** Résout l’URL publique d’une annonce (proxy / signed), comme les bannières Ads. */
  private async _resolveDocPictureUrl<
    T extends { pictureUrl?: string | null },
  >(doc: T): Promise<T> {
    const raw = doc.pictureUrl?.trim();
    if (!raw) return doc;
    const resolved =
      (await this._mediasService.resolvePublicMediaUrl(raw)) ?? raw;
    if (resolved === raw) return doc;
    return { ...doc, pictureUrl: resolved };
  }

  private async _resolveDocsPictureUrls<
    T extends { pictureUrl?: string | null },
  >(docs: T[]): Promise<T[]> {
    const out: T[] = [];
    for (const doc of docs) {
      out.push(await this._resolveDocPictureUrl(doc));
    }
    return out;
  }

  private async _bustAnnouncementsCache(): Promise<void> {
    try {
      await this._cacheLayer.bustKeyOnAllStores(AppCacheKeys.announcements);
    } catch (err) {
      this.logger.warn(
        `Announcements cache bust failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private _matchesAudience(
    doc: {
      audienceType?: AnnouncementAudienceTypeEnum;
      audienceUserIds?: unknown[];
    },
    userAudience: AnnouncementAudienceTypeEnum,
    userId: string,
  ): boolean {
    const type = doc.audienceType ?? AnnouncementAudienceTypeEnum.ALL;
    if (type === AnnouncementAudienceTypeEnum.ALL) return true;
    if (type === AnnouncementAudienceTypeEnum.CUSTOM_LIST) {
      const ids = (doc.audienceUserIds ?? []).map((id) => String(id));
      return userId ? ids.includes(userId) : false;
    }
    return type === userAudience;
  }

  private async _dismissedIdsForUser(userId: string): Promise<Set<string>> {
    const rows = await this._dismissalModel
      .find({ userId: new Types.ObjectId(userId) })
      .select('announcementId')
      .lean()
      .exec();
    return new Set(rows.map((r) => String(r.announcementId)));
  }
}

function userRegion(user: UserModel): string {
  return String(user.appCountryCode ?? 'CA')
    .trim()
    .toUpperCase()
    .slice(0, 2);
}
