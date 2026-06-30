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
  ForbiddenException,
  Inject,
  Injectable,
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
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

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

@Injectable()
export class AnnouncementsService {
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
    return docs.filter((doc) => {
      const id = String(doc._id ?? '');
      if (dismissed.has(id)) return false;
      if (!isWithinSchedule(doc)) return false;
      return this._matchesAudience(doc, audience, args.user._id.toString());
    });
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
        return docs.filter((doc) =>
          this._matchesAudience(doc, AnnouncementAudienceTypeEnum.CUSTOMER, ''),
        );
      },
    );
  }

  async listManage(user: UserModel) {
    assertAdmin(user);
    return this._announcementModel
      .find({})
      .sort({ sortOrder: 1, updatedAt: -1 })
      .lean()
      .exec();
  }

  async create(
    args: CreateAnnouncementDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    assertAdmin(user);
    const payload = await this._buildPayload(args, user, image);
    const created = await this._announcementModel.create(payload);
    await this._cacheLayer.bustKeyOnAllStores(AppCacheKeys.announcements);
    return created;
  }

  async update(
    id: string,
    args: UpdateAnnouncementDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    assertAdmin(user);
    const payload = await this._buildPayload(args, user, image);
    await this._announcementModel.updateOne({ _id: id }, { $set: payload });
    await this._cacheLayer.bustKeyOnAllStores(AppCacheKeys.announcements);
    const doc = await this._announcementModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException('announcement_not_found');
    return doc;
  }

  async remove(id: string, user: UserModel) {
    assertAdmin(user);
    await this._announcementModel.deleteOne({ _id: id });
    await this._dismissalModel.deleteMany({ announcementId: id });
    await this._cacheLayer.bustKeyOnAllStores(AppCacheKeys.announcements);
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

  private async _buildPayload(
    args: CreateAnnouncementDto | UpdateAnnouncementDto,
    user: UserModel,
    image?: Express.Multer.File,
  ) {
    const payload: Record<string, unknown> = {
      isActive: args.isActive,
      text: String(args.text ?? '').trim(),
      subtitle: String(args.subtitle ?? '').trim(),
      actionText: String(args.actionText ?? '').trim(),
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
    }
    return payload;
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
