import {
  AdBannerImageJsonDto,
  CreateAdManagementDto,
  isAdLinkActionType,
  PatchAdManagementDto,
} from '@modules/ads/dto/ad-management.dto';
import { TrackAdEventDto } from '@modules/ads/dto/ad-tracking.dto';
import {
  pipelineActiveStoresWithStripeOnboarded,
  resolveStoreIdsVisibleOnMobileApp,
} from '@modules/billing/stripe/stripe-connect-visibility';
import { MediasService } from '@modules/medias/medias.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AdEventModel,
  AdEventTypeEnum,
} from '@schemas/ad-event.schema';
import {
  AdModel,
  StoreAdActionTypeEnum,
} from '@schemas/ad.schema';
import { ProductModel } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

function productRefId(id: string): NonNullable<AdModel['product']> {
  return new Types.ObjectId(id) as unknown as NonNullable<AdModel['product']>;
}

export type AdManagementRow = {
  id: string;
  storeId: string | null;
  storeName: string | null;
  title: string;
  subtitle: string;
  actionText: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
  actionType: StoreAdActionTypeEnum;
  /** Numéro, e-mail ou URL selon `actionType`. */
  actionTarget: string | null;
  productId: string | null;
  productTitle: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type AdStatsRecentEvent = {
  eventType: AdEventTypeEnum;
  createdAt: string;
  userId: string | null;
  userEmail: string | null;
  userFullName: string | null;
  clientInstallId: string | null;
};

export type AdStatsDayBucket = {
  date: string;
  impressions: number;
  clicks: number;
};

export type AdStatsPayload = {
  adId: string;
  impressionsTotal: number;
  clicksTotal: number;
  uniqueUsersImpressions: number;
  uniqueUsersClicks: number;
  uniqueClientDevices: number;
  last7Days: AdStatsDayBucket[];
  recentEvents: AdStatsRecentEvent[];
};

@Injectable()
export class AdsService implements OnModuleInit {
  private static readonly _LIST_TTL_MS = 30_000;
  private _listCache: {
    at: number;
    data: AdModel[];
    stripeFiltered: boolean;
  } | null = null;

  @InjectModel(AdModel.name)
  private readonly adModel: Model<AdModel>;

  @InjectModel(AdEventModel.name)
  private readonly _adEventModel: Model<AdEventModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(ProductModel.name)
  private readonly _productModel: Model<ProductModel>;

  @Inject(MediasService)
  private readonly _mediasService: MediasService;

  async onModuleInit() {
    await this.seedIfEmpty();
  }

  private invalidateListCache() {
    this._listCache = null;
  }

  private assertVendorOrAdmin(user: UserModel) {
    if (
      user.type !== UserTypeEnum.ADMIN &&
      user.type !== UserTypeEnum.VENDOR
    ) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
  }

  async uploadBannerImage(
    user: UserModel,
    file?: Express.Multer.File,
  ): Promise<{ url: string }> {
    this.assertVendorOrAdmin(user);
    if (!file?.buffer?.length) {
      throw new BadRequestException('empty_image');
    }
    const url = await this._mediasService.upload(file, user, 'marketing/ads');
    return { url };
  }

  /** Même destination Storage que multipart ; corps JSON pour proxys qui coupent multipart. */
  async uploadBannerImageJson(
    user: UserModel,
    dto: AdBannerImageJsonDto,
  ): Promise<{ url: string }> {
    this.assertVendorOrAdmin(user);
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
    const max = 5 * 1024 * 1024;
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (dto.filename || 'banner.jpg').trim() || 'banner.jpg';
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
      fieldname: 'file',
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
    const url = await this._mediasService.upload(file, user, 'marketing/ads');
    return { url };
  }

  private async assertUserCanManageStore(
    user: UserModel,
    storeId: string,
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN) return;
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
    const sid = new Types.ObjectId(storeId);
    const n = await this._storeModel
      .countDocuments({ _id: sid, owner: user._id })
      .exec();
    if (!n) {
      throw new ForbiddenException('store_not_owned');
    }
  }

  private async vendorStoreIds(user: UserModel): Promise<Types.ObjectId[]> {
    const docs = await this._storeModel
      .find({ owner: user._id })
      .select('_id')
      .lean()
      .exec();
    return docs.map((d) => d._id as Types.ObjectId);
  }

  /** Valide et normalise la cible pour les actions « lien / contact ». */
  private assertActionTargetValue(
    actionType: StoreAdActionTypeEnum,
    raw: string | undefined | null,
  ): string {
    if (!isAdLinkActionType(actionType)) {
      return '';
    }
    const t = (raw ?? '').trim();
    if (!t) {
      throw new BadRequestException('action_target_required');
    }
    if (actionType === StoreAdActionTypeEnum.EMAIL) {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
      if (!ok) {
        throw new BadRequestException('invalid_action_target_email');
      }
      return t;
    }
    if (actionType === StoreAdActionTypeEnum.WEBSITE) {
      try {
        const u = new URL(/^[a-z]+:/i.test(t) ? t : `https://${t}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          throw new BadRequestException('invalid_action_target_url');
        }
        return u.toString();
      } catch {
        throw new BadRequestException('invalid_action_target_url');
      }
    }
    const digits = t.replace(/\D/g, '');
    if (digits.length < 6) {
      throw new BadRequestException('invalid_action_target_phone');
    }
    return t;
  }

  private assertDateRange(validFrom: Date, validUntil: Date) {
    if (!(validFrom instanceof Date) || Number.isNaN(validFrom.getTime())) {
      throw new BadRequestException('invalid_valid_from');
    }
    if (!(validUntil instanceof Date) || Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('invalid_valid_until');
    }
    if (validUntil.getTime() <= validFrom.getTime()) {
      throw new BadRequestException('valid_until_must_be_after_valid_from');
    }
  }

  private toManagementRow(doc: Record<string, unknown>): AdManagementRow {
    const id = String(doc._id ?? doc.id ?? '');
    const st = doc.store as
      | { _id?: Types.ObjectId; name?: string }
      | Types.ObjectId
      | string
      | undefined
      | null;
    let storeId: string | null = null;
    let storeName: string | null = null;
    if (st && typeof st === 'object' && '_id' in st) {
      storeId = (st._id as Types.ObjectId).toString();
      storeName = String((st as { name?: string }).name ?? '') || null;
    } else if (st instanceof Types.ObjectId) {
      storeId = st.toString();
    } else if (typeof st === 'string' && st) {
      storeId = st;
    }
    const pr = doc.product as
      | { _id?: Types.ObjectId; title?: string }
      | Types.ObjectId
      | string
      | undefined
      | null;
    let productId: string | null = null;
    let productTitle: string | null = null;
    if (pr && typeof pr === 'object' && '_id' in pr) {
      productId = (pr._id as Types.ObjectId).toString();
      productTitle = String((pr as { title?: string }).title ?? '') || null;
    } else if (pr instanceof Types.ObjectId) {
      productId = pr.toString();
    } else if (typeof pr === 'string' && pr) {
      productId = pr;
    }
    const vf = doc.validFrom as Date | string | undefined | null;
    const vu = doc.validUntil as Date | string | undefined | null;
    const at =
      (doc.actionType as StoreAdActionTypeEnum) ??
      StoreAdActionTypeEnum.SHOP;
    const validFromIso =
      vf == null
        ? null
        : vf instanceof Date
          ? vf.toISOString()
          : String(vf);
    const validUntilIso =
      vu == null
        ? null
        : vu instanceof Date
          ? vu.toISOString()
          : String(vu);
    const actTarget =
      doc.actionTarget != null && String(doc.actionTarget).trim() !== ''
        ? String(doc.actionTarget).trim()
        : null;
    return {
      id,
      storeId,
      storeName,
      title: String(doc.title ?? ''),
      subtitle: String(doc.subtitle ?? ''),
      actionText: String(doc.actionText ?? ''),
      imageUrl: doc.imageUrl != null ? String(doc.imageUrl) : null,
      sortOrder: Number(doc.sortOrder ?? 0),
      isActive: Boolean(doc.isActive),
      validFrom: validFromIso,
      validUntil: validUntilIso,
      actionType: at,
      actionTarget: actTarget,
      productId,
      productTitle,
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : doc.createdAt != null
            ? String(doc.createdAt)
            : undefined,
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : doc.updatedAt != null
            ? String(doc.updatedAt)
            : undefined,
    };
  }

  private passesDateWindow(
    validFrom: Date | undefined,
    validUntil: Date | undefined,
    now: Date,
  ): boolean {
    if (!validFrom && !validUntil) return true;
    if (validFrom && now.getTime() < new Date(validFrom).getTime()) {
      return false;
    }
    if (validUntil && now.getTime() > new Date(validUntil).getTime()) {
      return false;
    }
    return true;
  }

  /**
   * Complète `store` quand `.populate` laisse un ObjectId (ref, version driver, etc.) :
   * sans ça, le filtre public excluait toutes les pubs boutique.
   */
  private async hydrateStoresForPublicAds(
    docs: Record<string, unknown>[],
  ): Promise<void> {
    const needHydration: { index: number; id: Types.ObjectId }[] = [];

    for (let i = 0; i < docs.length; i++) {
      const st = docs[i]['store'];
      if (st == null) continue;
      if (st instanceof Types.ObjectId) {
        needHydration.push({ index: i, id: st });
        continue;
      }
      if (typeof st === 'object' && !Array.isArray(st)) {
        const o = st as Record<string, unknown>;
        const hasPopulatedFields =
          typeof o['status'] === 'string' || typeof o['name'] === 'string';
        if (!hasPopulatedFields) {
          const idRaw = o['_id'] ?? o['id'];
          try {
            const id =
              idRaw instanceof Types.ObjectId
                ? idRaw
                : new Types.ObjectId(String(idRaw));
            needHydration.push({ index: i, id });
          } catch {
            // id invalide
          }
        }
      }
    }

    if (!needHydration.length) return;

    const uniqueIds = [
      ...new Map(needHydration.map((x) => [x.id.toString(), x.id])).values(),
    ];

    const stores = await this._storeModel
      .aggregate([
        ...pipelineActiveStoresWithStripeOnboarded(uniqueIds),
        { $project: { name: 1, profileImage: 1, status: 1 } },
      ])
      .exec();

    const byId = new Map(
      stores.map((s) => {
        const sid = String((s as { _id?: unknown })._id ?? '');
        return [sid, s] as const;
      }),
    );

    for (const { index, id } of needHydration) {
      const full = byId.get(id.toString());
      if (full != null) {
        docs[index]['store'] = full as unknown;
      }
    }
  }

  /**
   * Pub « liée boutique » : `store` peuplé (pas une simple ref orpheline) — distincte des bannières globales admin.
   */
  private isShopRelatedPublicAd(d: AdModel): boolean {
    const st = d.store as
      | { status?: string }
      | Types.ObjectId
      | null
      | undefined;
    if (st == null) return false;
    if (st instanceof Types.ObjectId) return false;
    return typeof st === 'object';
  }

  /**
   * Réordonne les pubs pour qu’au moins **2/3** des entrées soient des pubs liées boutique,
   * lorsque la base contient assez de telles pubs. Sinon : toutes les pubs boutique en tête, puis les globales.
   * (Même ensemble d’éléments, ordre seulement.)
   */
  private orderPublicAdsByMinTwoThirdsShop(orderedAll: AdModel[]): AdModel[] {
    const shopAds: AdModel[] = [];
    const globalAds: AdModel[] = [];
    for (const d of orderedAll) {
      if (this.isShopRelatedPublicAd(d)) {
        shopAds.push(d);
      } else {
        globalAds.push(d);
      }
    }
    const n = shopAds.length + globalAds.length;
    if (n === 0) {
      return [];
    }
    const minShopSlots = Math.ceil((2 * n) / 3);
    if (shopAds.length < minShopSlots) {
      return [...shopAds, ...globalAds];
    }
    const remainingShops = [...shopAds];
    const remainingGlobals = [...globalAds];
    const out: AdModel[] = [];
    while (out.length < n) {
      for (let k = 0; k < 2 && remainingShops.length > 0 && out.length < n; k++) {
        out.push(remainingShops.shift()!);
      }
      if (out.length >= n) break;
      if (remainingGlobals.length > 0) {
        out.push(remainingGlobals.shift()!);
      } else {
        while (remainingShops.length > 0 && out.length < n) {
          out.push(remainingShops.shift()!);
        }
      }
    }
    while (remainingGlobals.length > 0 && out.length < n) {
      out.push(remainingGlobals.shift()!);
    }
    while (remainingShops.length > 0 && out.length < n) {
      out.push(remainingShops.shift()!);
    }
    return out;
  }

  private _storeIdFromAdDoc(d: Record<string, unknown>): Types.ObjectId | null {
    const st = d.store;
    if (st == null) return null;
    if (st instanceof Types.ObjectId) return st;
    if (typeof st === 'object' && !Array.isArray(st)) {
      const o = st as Record<string, unknown>;
      const raw = o['_id'] ?? o['id'];
      if (raw instanceof Types.ObjectId) return raw;
      const s = raw != null ? String(raw).trim() : '';
      if (Types.ObjectId.isValid(s)) return new Types.ObjectId(s);
    }
    return null;
  }

  /**
   * Bannières pour l’accueil public : globales (sans boutique) +
   * publicités boutiques actives (boutique ACTIVE, dates valides).
   * Ordre renvoyé : au moins 2/3 de pubs **liées boutique** (`store` défini) quand le stock le permet.
   */
  async listPublic(): Promise<AdModel[]> {
    const now = Date.now();
    // Ne pas servir un cache calculé avant le filtre Stripe Connect (paiements vendeur).
    if (
      this._listCache &&
      this._listCache.stripeFiltered === true &&
      now - this._listCache.at < AdsService._LIST_TTL_MS
    ) {
      return this._listCache.data;
    }
    const raw = await this.adModel
      .find({ isActive: true })
      .populate('store', 'name profileImage status')
      .populate('product', 'title')
      .sort({ sortOrder: 1 })
      .lean()
      .exec();
    const docs = raw as unknown as Record<string, unknown>[];
    await this.hydrateStoresForPublicAds(docs);
    const shopStoreIds = [
      ...new Set(
        docs
          .map((d) => this._storeIdFromAdDoc(d))
          .filter((id): id is Types.ObjectId => id != null)
          .map((id) => id.toString()),
      ),
    ].map((s) => new Types.ObjectId(s));
    const paymentsReadyStoreIds = await resolveStoreIdsVisibleOnMobileApp(
      this._storeModel,
      shopStoreIds,
    );
    const t = new Date();
    const data = docs.filter((d) => {
      if (
        !this.passesDateWindow(
          d.validFrom as Date | undefined,
          d.validUntil as Date | undefined,
          t,
        )
      ) {
        return false;
      }
      const storeOid = this._storeIdFromAdDoc(d);
      if (storeOid == null) return true;
      return paymentsReadyStoreIds.has(storeOid.toString());
    }) as unknown as AdModel[];
    const ordered = this.orderPublicAdsByMinTwoThirdsShop(data);
    this._listCache = { at: now, data: ordered, stripeFiltered: true };
    return ordered;
  }

  /** @deprecated Utiliser `listPublic` (même comportement). */
  async list(): Promise<AdModel[]> {
    return this.listPublic();
  }

  async listForManagement(user: UserModel): Promise<AdManagementRow[]> {
    this.assertVendorOrAdmin(user);
    if (user.type === UserTypeEnum.ADMIN) {
      const docs = await this.adModel
        .find()
        .populate('store', 'name')
        .populate('product', 'title')
        .sort({ sortOrder: 1, createdAt: -1 })
        .lean()
        .exec();
      return docs.map((d) => this.toManagementRow(d as Record<string, unknown>));
    }
    const ids = await this.vendorStoreIds(user);
    if (!ids.length) {
      return [];
    }
    const docs = await this.adModel
      .find({ store: { $in: ids } })
      .populate('store', 'name')
      .populate('product', 'title')
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => this.toManagementRow(d as Record<string, unknown>));
  }

  private async assertProductBelongsToStore(
    productId: string,
    storeId: string,
  ): Promise<void> {
    const n = await this._productModel
      .countDocuments({
        _id: new Types.ObjectId(productId),
        store: new Types.ObjectId(storeId),
      })
      .exec();
    if (!n) {
      throw new BadRequestException('product_not_in_store');
    }
  }

  async createManagement(
    user: UserModel,
    dto: CreateAdManagementDto,
  ): Promise<AdManagementRow> {
    this.assertVendorOrAdmin(user);
    const storeIdRaw = dto.storeId?.trim();
    const storeOid =
      storeIdRaw && Types.ObjectId.isValid(storeIdRaw)
        ? new Types.ObjectId(storeIdRaw)
        : undefined;

    if (user.type === UserTypeEnum.VENDOR) {
      if (!storeOid) {
        throw new ForbiddenException('global_ad_vendor_forbidden');
      }
      await this.assertUserCanManageStore(user, storeOid.toString());
    }

    if (!storeOid && dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
      throw new BadRequestException('global_product_action_forbidden');
    }

    if (storeOid) {
      await this.assertUserCanManageStore(user, storeOid.toString());
    }

    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    this.assertDateRange(validFrom, validUntil);

    if (dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
      if (!dto.productId || !storeOid) {
        throw new BadRequestException('product_required_for_action');
      }
      await this.assertProductBelongsToStore(dto.productId, storeOid.toString());
    }

    const linkTarget = isAdLinkActionType(dto.actionType)
      ? this.assertActionTargetValue(dto.actionType, dto.actionTarget)
      : undefined;

    const created = await this.adModel.create({
      isActive: dto.isActive !== false,
      title: dto.title.trim(),
      subtitle: dto.subtitle.trim(),
      actionText: dto.actionText.trim(),
      imageUrl: dto.imageUrl?.trim() || undefined,
      sortOrder: dto.sortOrder ?? 0,
      store: storeOid,
      validFrom,
      validUntil,
      actionType: dto.actionType,
      actionTarget: linkTarget || undefined,
      product:
        dto.actionType === StoreAdActionTypeEnum.PRODUCT && dto.productId
          ? productRefId(dto.productId)
          : undefined,
    });

    this.invalidateListCache();

    const populated = await this.adModel
      .findById(created._id)
      .populate('store', 'name')
      .populate('product', 'title')
      .lean()
      .exec();
    return this.toManagementRow(populated as Record<string, unknown>);
  }

  async patchManagement(
    user: UserModel,
    id: string,
    dto: PatchAdManagementDto,
  ): Promise<AdManagementRow> {
    this.assertVendorOrAdmin(user);
    const oid = new Types.ObjectId(id);
    const existing = await this.adModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }

    const storeRef = existing.store;
    const storeIdStr = storeRef != null ? String(storeRef) : null;
    if (storeIdStr) {
      await this.assertUserCanManageStore(user, storeIdStr);
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }

    const nextAction =
      dto.actionType ?? existing.actionType ?? StoreAdActionTypeEnum.SHOP;
    if (!storeIdStr && nextAction === StoreAdActionTypeEnum.PRODUCT) {
      throw new BadRequestException('global_product_action_forbidden');
    }

    if (dto.validFrom != null || dto.validUntil != null) {
      const nf =
        dto.validFrom != null
          ? new Date(dto.validFrom)
          : existing.validFrom
            ? new Date(existing.validFrom as Date)
            : null;
      const nu =
        dto.validUntil != null
          ? new Date(dto.validUntil)
          : existing.validUntil
            ? new Date(existing.validUntil as Date)
            : null;
      if (!nf || !nu) {
        throw new BadRequestException('ad_dates_incomplete');
      }
      this.assertDateRange(nf, nu);
      if (dto.validFrom != null) existing.validFrom = nf;
      if (dto.validUntil != null) existing.validUntil = nu;
    }

    if (dto.title != null) existing.title = dto.title.trim();
    if (dto.subtitle != null) existing.subtitle = dto.subtitle.trim();
    if (dto.actionText != null) existing.actionText = dto.actionText.trim();
    if (dto.imageUrl !== undefined) {
      existing.imageUrl =
        dto.imageUrl === null || dto.imageUrl === ''
          ? undefined
          : dto.imageUrl.trim();
    }
    if (dto.sortOrder != null) existing.sortOrder = dto.sortOrder;
    if (dto.isActive != null) existing.isActive = dto.isActive;
    if (dto.actionType != null) existing.actionType = dto.actionType;

    const effectiveStoreId = storeIdStr;
    if (dto.actionType === StoreAdActionTypeEnum.SHOP) {
      existing.product = undefined;
      existing.actionTarget = undefined;
    } else if (dto.actionType === StoreAdActionTypeEnum.PRODUCT) {
      existing.actionTarget = undefined;
      const pid = dto.productId;
      if (!pid || !effectiveStoreId) {
        throw new BadRequestException('product_required_for_action');
      }
      await this.assertProductBelongsToStore(pid, effectiveStoreId);
      existing.product = productRefId(pid);
    } else if (dto.actionType != null && isAdLinkActionType(dto.actionType)) {
      existing.product = undefined;
      if (dto.actionTarget !== undefined) {
        existing.actionTarget =
          dto.actionTarget === null || dto.actionTarget === ''
            ? undefined
            : this.assertActionTargetValue(
                dto.actionType,
                dto.actionTarget,
              );
      }
    }

    if (dto.productId === null) {
      existing.product = undefined;
    } else if (
      dto.productId &&
      !dto.actionType &&
      existing.actionType === StoreAdActionTypeEnum.PRODUCT &&
      effectiveStoreId
    ) {
      await this.assertProductBelongsToStore(dto.productId, effectiveStoreId);
      existing.product = productRefId(dto.productId);
    }

    if (
      dto.actionTarget !== undefined &&
      dto.actionType == null &&
      isAdLinkActionType(
        existing.actionType as StoreAdActionTypeEnum,
      )
    ) {
      existing.actionTarget =
        dto.actionTarget === null || dto.actionTarget === ''
          ? undefined
          : this.assertActionTargetValue(
              existing.actionType as StoreAdActionTypeEnum,
              dto.actionTarget,
            );
    }

    const finalType =
      (existing.actionType as StoreAdActionTypeEnum) ??
      StoreAdActionTypeEnum.SHOP;
    if (isAdLinkActionType(finalType)) {
      existing.actionTarget = this.assertActionTargetValue(
        finalType,
        existing.actionTarget,
      );
    } else {
      existing.actionTarget = undefined;
    }

    await existing.save();
    this.invalidateListCache();

    const populated = await this.adModel
      .findById(oid)
      .populate('store', 'name')
      .populate('product', 'title')
      .lean()
      .exec();
    return this.toManagementRow(populated as Record<string, unknown>);
  }

  async removeManagement(user: UserModel, id: string): Promise<void> {
    this.assertVendorOrAdmin(user);
    const oid = new Types.ObjectId(id);
    const existing = await this.adModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    const storeRef = existing.store;
    const storeIdStr = storeRef != null ? String(storeRef) : null;
    if (storeIdStr) {
      await this.assertUserCanManageStore(user, storeIdStr);
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }

    const res = await this.adModel.deleteOne({ _id: oid }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('ad_not_found');
    }
    this.invalidateListCache();
  }

  private async assertAdTrackableForClient(adId: string): Promise<void> {
    const oid = new Types.ObjectId(adId);
    const doc = await this.adModel.findById(oid).lean().exec();
    if (!doc || !doc.isActive) {
      throw new NotFoundException('ad_not_found');
    }
    const t = new Date();
    if (
      !this.passesDateWindow(
        doc.validFrom as Date | undefined,
        doc.validUntil as Date | undefined,
        t,
      )
    ) {
      throw new BadRequestException('ad_not_trackable');
    }
  }

  async trackEvent(
    user: UserModel | undefined | null,
    dto: TrackAdEventDto,
  ): Promise<{ ok: true }> {
    await this.assertAdTrackableForClient(dto.adId);
    const oid = new Types.ObjectId(dto.adId);
    const uid =
      user && (user as UserModel)._id
        ? ((user as UserModel)._id as Types.ObjectId)
        : undefined;
    const install = dto.clientInstallId?.trim().slice(0, 128);
    await this._adEventModel.create({
      ad: oid,
      user: uid,
      eventType: dto.eventType,
      ...(install ? { clientInstallId: install } : {}),
    });
    return { ok: true };
  }

  private async assertUserCanManageAdById(
    user: UserModel,
    adId: string,
  ): Promise<void> {
    const oid = new Types.ObjectId(adId);
    const existing = await this.adModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('ad_not_found');
    }
    const storeRef = existing.store;
    const storeIdStr = storeRef != null ? String(storeRef) : null;
    if (storeIdStr) {
      await this.assertUserCanManageStore(user, storeIdStr);
    } else if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('global_ad_vendor_forbidden');
    }
  }

  async getAdStats(user: UserModel, adId: string): Promise<AdStatsPayload> {
    this.assertVendorOrAdmin(user);
    await this.assertUserCanManageAdById(user, adId);
    const oid = new Types.ObjectId(adId);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 6);
    since.setUTCHours(0, 0, 0, 0);

    const [
      impressionsTotal,
      clicksTotal,
      impUsers,
      clkUsers,
      deviceIds,
      byDay,
      recentDocs,
    ] = await Promise.all([
      this._adEventModel
        .countDocuments({ ad: oid, eventType: AdEventTypeEnum.IMPRESSION })
        .exec(),
      this._adEventModel
        .countDocuments({ ad: oid, eventType: AdEventTypeEnum.CLICK })
        .exec(),
      this._adEventModel.distinct('user', {
        ad: oid,
        eventType: AdEventTypeEnum.IMPRESSION,
        user: { $exists: true, $ne: null },
      }),
      this._adEventModel.distinct('user', {
        ad: oid,
        eventType: AdEventTypeEnum.CLICK,
        user: { $exists: true, $ne: null },
      }),
      this._adEventModel.distinct('clientInstallId', {
        ad: oid,
        clientInstallId: { $exists: true, $nin: [null, ''] },
      }),
      this._adEventModel
        .aggregate<{
          _id: string;
          impressions: number;
          clicks: number;
        }>([
          {
            $match: {
              ad: oid,
              createdAt: { $gte: since },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt',
                  timezone: 'UTC',
                },
              },
              impressions: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AdEventTypeEnum.IMPRESSION] },
                    1,
                    0,
                  ],
                },
              },
              clicks: {
                $sum: {
                  $cond: [
                    { $eq: ['$eventType', AdEventTypeEnum.CLICK] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .exec(),
      this._adEventModel
        .find({ ad: oid })
        .sort({ createdAt: -1 })
        .limit(80)
        .populate('user', 'email fullName')
        .lean()
        .exec(),
    ]);

    const recentEvents: AdStatsRecentEvent[] = recentDocs.map((row) => {
      const r = row as Record<string, unknown>;
      const u = r.user as
        | { _id?: Types.ObjectId; email?: string; fullName?: string }
        | Types.ObjectId
        | null
        | undefined;
      let userId: string | null = null;
      let userEmail: string | null = null;
      let userFullName: string | null = null;
      if (u && typeof u === 'object' && '_id' in u) {
        const pop = u as { _id?: Types.ObjectId; email?: string; fullName?: string };
        userId = pop._id ? pop._id.toString() : null;
        userEmail = pop.email != null ? String(pop.email) : null;
        userFullName = pop.fullName != null ? String(pop.fullName) : null;
      }
      const ca = r.createdAt as Date | string | undefined;
      return {
        eventType: r.eventType as AdEventTypeEnum,
        createdAt:
          ca instanceof Date ? ca.toISOString() : String(ca ?? new Date()),
        userId,
        userEmail,
        userFullName,
        clientInstallId:
          r.clientInstallId != null ? String(r.clientInstallId) : null,
      };
    });

    const last7Days: AdStatsDayBucket[] = byDay.map((d) => ({
      date: d._id,
      impressions: d.impressions,
      clicks: d.clicks,
    }));

    return {
      adId,
      impressionsTotal,
      clicksTotal,
      uniqueUsersImpressions: impUsers.filter(Boolean).length,
      uniqueUsersClicks: clkUsers.filter(Boolean).length,
      uniqueClientDevices: deviceIds.filter(Boolean).length,
      last7Days,
      recentEvents,
    };
  }

  async seedIfEmpty() {
    const count = await this.adModel.countDocuments().exec();
    if (count > 0) return;
    await this.adModel.insertMany([
      {
        isActive: true,
        title: 'Special Offer',
        subtitle: 'Discount 20% off applied at checkout',
        actionText: 'Order Now',
        imageUrl: null,
        sortOrder: 0,
        actionType: StoreAdActionTypeEnum.SHOP,
      },
      {
        isActive: true,
        title: 'Free Delivery',
        subtitle: 'On orders over $25 this week',
        actionText: 'Shop Now',
        imageUrl: null,
        sortOrder: 1,
        actionType: StoreAdActionTypeEnum.SHOP,
      },
      {
        isActive: true,
        title: 'New Arrivals',
        subtitle: 'Discover our latest dishes',
        actionText: 'Explore',
        imageUrl: null,
        sortOrder: 2,
        actionType: StoreAdActionTypeEnum.SHOP,
      },
    ]);
  }
}
