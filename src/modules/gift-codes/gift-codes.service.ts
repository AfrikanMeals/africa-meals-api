import {
  CreateGiftCodeDto,
  PatchGiftCodeDto,
} from '@modules/gift-codes/dto/gift-code.dto';
import { GiftCodeImageJsonDto } from '@modules/gift-codes/dto/gift-code-image.dto';
import { GiftCodeActivationNotifierService } from '@modules/gift-codes/gift-code-activation-notifier.service';
import { MediasService } from '@modules/medias/medias.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  GiftCodeDiscountTypeEnum,
  GiftCodeModel,
  GiftCodePromoTypeEnum,
  GiftCodeScopeTypeEnum,
} from '@schemas/gift_code.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

export type GiftCodeApiRow = {
  id: string;
  code: string;
  scopeType: GiftCodeScopeTypeEnum;
  storeIds: string[];
  storeNames: string[];
  regionCodes: string[];
  regionNames: string[];
  discountType: GiftCodeDiscountTypeEnum;
  promoType: GiftCodePromoTypeEnum;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  value: number;
  validFrom: string;
  validUntil: string;
  enabled: boolean;
  usedCount: number;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  createdAt?: string;
  updatedAt?: string;
};

export type PublicGiftCodeRow = {
  id: string;
  code: string;
  promoType: GiftCodePromoTypeEnum;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  discountLabel: string;
  validUntil: string;
  scopeType: GiftCodeScopeTypeEnum;
};

@Injectable()
export class GiftCodesService {
  constructor(
    @InjectModel(GiftCodeModel.name)
    private readonly _giftCodeModel: Model<GiftCodeModel>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    private readonly _storeAccess: StoreAccessService,
    private readonly _supportedCountries: SupportedCountriesService,
    private readonly _activationNotifier: GiftCodeActivationNotifierService,
    private readonly _mediasService: MediasService,
  ) {}

  private async assertAdmin(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this._storeAccess.assertAdminPermission(user, 'admin.marketing');
  }

  private validateValue(
    discountType: GiftCodeDiscountTypeEnum,
    value: number,
  ) {
    if (discountType === GiftCodeDiscountTypeEnum.FIXED) {
      if (value < 0.01 || value > 999_999) {
        throw new BadRequestException('invalid_fixed_discount');
      }
    } else if (value < 1 || value > 100) {
      throw new BadRequestException('invalid_percentage_discount');
    }
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

  private async resolveStoreNames(
    storeIds: Types.ObjectId[],
  ): Promise<string[]> {
    if (!storeIds.length) return [];
    const docs = await this._storeModel
      .find({ _id: { $in: storeIds } })
      .select('name')
      .lean()
      .exec();
    const byId = new Map(
      docs.map((d) => [String(d._id), String(d.name ?? '')]),
    );
    return storeIds.map((id) => byId.get(String(id)) ?? String(id));
  }

  private async resolveRegionNames(codes: string[]): Promise<string[]> {
    if (!codes.length) return [];
    const active = await this._supportedCountries.listActive();
    const byCode = new Map(
      active.map((r) => [r.code.toUpperCase(), String(r.name ?? r.code)]),
    );
    return codes.map((c) => byCode.get(c.toUpperCase()) ?? c.toUpperCase());
  }

  private formatDiscountLabel(
    discountType: GiftCodeDiscountTypeEnum,
    value: number,
  ): string {
    if (discountType === GiftCodeDiscountTypeEnum.PERCENTAGE) {
      const pct = Math.round(value * 100) / 100;
      return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}% OFF`;
    }
    const amt = Math.round(value * 100) / 100;
    return `${amt % 1 === 0 ? amt.toFixed(0) : amt.toFixed(2)} OFF`;
  }

  private async resolveImageUrl(raw: unknown): Promise<string | null> {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const url = raw.trim();
    const resolved =
      (await this._mediasService.resolvePublicMediaUrl(url)) ?? url;
    return resolved.trim() || null;
  }

  private async toRow(doc: Record<string, unknown>): Promise<GiftCodeApiRow> {
    const id = String(doc._id ?? doc.id ?? '');
    const rawIds = (doc.storeIds as Types.ObjectId[] | undefined) ?? [];
    const storeIds = rawIds.map((s) => String(s));
    const storeNames = await this.resolveStoreNames(rawIds);
    const regionCodes = ((doc.regionCodes as string[] | undefined) ?? []).map(
      (c) => String(c).toUpperCase(),
    );
    const regionNames = await this.resolveRegionNames(regionCodes);
    const vf = doc.validFrom as Date | string;
    const vu = doc.validUntil as Date | string;
    return {
      id,
      code: String(doc.code ?? ''),
      scopeType: doc.scopeType as GiftCodeScopeTypeEnum,
      storeIds,
      storeNames,
      regionCodes,
      regionNames,
      discountType: doc.discountType as GiftCodeDiscountTypeEnum,
      promoType:
        (doc.promoType as GiftCodePromoTypeEnum | undefined) ??
        GiftCodePromoTypeEnum.DISCOUNT,
      title: String(doc.title ?? doc.code ?? '').trim(),
      subtitle: String(doc.subtitle ?? '').trim(),
      imageUrl: await this.resolveImageUrl(doc.imageUrl),
      value: Number(doc.value ?? 0),
      validFrom: vf instanceof Date ? vf.toISOString() : String(vf),
      validUntil: vu instanceof Date ? vu.toISOString() : String(vu),
      enabled: Boolean(doc.enabled),
      usedCount: Number(doc.usedCount ?? 0),
      maxUses: doc.maxUses == null ? null : Number(doc.maxUses),
      maxUsesPerUser:
        doc.maxUsesPerUser == null ? null : Number(doc.maxUsesPerUser),
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

  private async validateStoreIds(storeIds: string[]): Promise<Types.ObjectId[]> {
    if (!storeIds.length) {
      throw new BadRequestException('store_ids_required');
    }
    const oids = storeIds.map((id) => {
      try {
        return new Types.ObjectId(id);
      } catch {
        throw new BadRequestException('invalid_store_id');
      }
    });
    const count = await this._storeModel
      .countDocuments({ _id: { $in: oids } })
      .exec();
    if (count !== oids.length) {
      throw new BadRequestException('store_not_found');
    }
    return oids;
  }

  private async validateRegionCodes(rawCodes: string[]): Promise<string[]> {
    if (!rawCodes.length) {
      throw new BadRequestException('region_codes_required');
    }
    const codes = [
      ...new Set(
        rawCodes
          .map((c) => normalizeCountryCode(c))
          .filter((c) => c.length === 2),
      ),
    ];
    if (!codes.length) {
      throw new BadRequestException('invalid_region_code');
    }
    const active = new Set(
      (await this._supportedCountries.listActive()).map((r) =>
        r.code.toUpperCase(),
      ),
    );
    for (const code of codes) {
      if (!active.has(code)) {
        throw new BadRequestException('region_not_found');
      }
    }
    return codes;
  }

  private applyScopeFields(
    target: {
      scopeType: GiftCodeScopeTypeEnum;
      storeIds: Types.ObjectId[];
      regionCodes: string[];
    },
    scopeType: GiftCodeScopeTypeEnum,
    storeOids: Types.ObjectId[],
    regionCodes: string[],
  ) {
    target.scopeType = scopeType;
    if (scopeType === GiftCodeScopeTypeEnum.ALL) {
      target.storeIds = [];
      target.regionCodes = [];
      return;
    }
    if (scopeType === GiftCodeScopeTypeEnum.SPECIFIC) {
      target.storeIds = storeOids;
      target.regionCodes = [];
      return;
    }
    target.storeIds = [];
    target.regionCodes = regionCodes;
  }

  async listForAdmin(user: UserModel): Promise<GiftCodeApiRow[]> {
    await this.assertAdmin(user);
    const docs = await this._giftCodeModel
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return Promise.all(
      docs.map((d) => this.toRow(d as Record<string, unknown>)),
    );
  }

  /** Catalogue client : gift codes actifs visibles dans l'app (écran Promos). */
  async listPublicForClient(
    user: UserModel,
    clientRegion?: string,
  ): Promise<PublicGiftCodeRow[]> {
    const now = new Date();
    const regionCode = normalizeCountryCode(
      clientRegion ?? (user as { region?: string }).region,
    );
    const docs = await this._giftCodeModel
      .find({
        enabled: true,
        validFrom: { $lte: now },
        validUntil: { $gte: now },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const out: PublicGiftCodeRow[] = [];
    for (const raw of docs) {
      const doc = raw as Record<string, unknown>;
      const scopeType = doc.scopeType as GiftCodeScopeTypeEnum;
      const regionCodes = ((doc.regionCodes as string[] | undefined) ?? []).map(
        (c) => normalizeCountryCode(c),
      );
      if (
        scopeType === GiftCodeScopeTypeEnum.REGION &&
        regionCode &&
        regionCodes.length > 0 &&
        !regionCodes.includes(regionCode)
      ) {
        continue;
      }
      const discountType = doc.discountType as GiftCodeDiscountTypeEnum;
      const value = Number(doc.value ?? 0);
      const code = String(doc.code ?? '').trim();
      const vu = doc.validUntil as Date | string;
      out.push({
        id: String(doc._id ?? ''),
        code,
        promoType:
          (doc.promoType as GiftCodePromoTypeEnum | undefined) ??
          GiftCodePromoTypeEnum.DISCOUNT,
        title: String(doc.title ?? code).trim() || code,
        subtitle: String(doc.subtitle ?? '').trim(),
        imageUrl: await this.resolveImageUrl(doc.imageUrl),
        discountLabel: this.formatDiscountLabel(discountType, value),
        validUntil:
          vu instanceof Date ? vu.toISOString() : String(vu ?? ''),
        scopeType,
      });
    }
    return out;
  }

  async create(
    user: UserModel,
    dto: CreateGiftCodeDto,
  ): Promise<GiftCodeApiRow> {
    await this.assertAdmin(user);
    this.validateValue(dto.discountType, dto.value);
    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    this.assertDateRange(validFrom, validUntil);

    let storeOids: Types.ObjectId[] = [];
    let regionCodes: string[] = [];
    if (dto.scopeType === GiftCodeScopeTypeEnum.SPECIFIC) {
      storeOids = await this.validateStoreIds(dto.storeIds ?? []);
    } else if (dto.scopeType === GiftCodeScopeTypeEnum.REGION) {
      regionCodes = await this.validateRegionCodes(dto.regionCodes ?? []);
    }

    const code = dto.code.trim().toUpperCase();
    try {
      const created = await this._giftCodeModel.create({
        code,
        scopeType: dto.scopeType,
        storeIds: storeOids,
        regionCodes,
        discountType: dto.discountType,
        promoType: dto.promoType ?? GiftCodePromoTypeEnum.DISCOUNT,
        title: (dto.title ?? code).trim(),
        subtitle: (dto.subtitle ?? '').trim(),
        imageUrl: dto.imageUrl?.trim() || undefined,
        value: dto.value,
        validFrom,
        validUntil,
        enabled: dto.enabled !== false,
        usedCount: 0,
        maxUses: dto.maxUses,
        maxUsesPerUser: dto.maxUsesPerUser,
        userUsages: [],
      });
      const lean = await this._giftCodeModel
        .findById(created._id)
        .lean()
        .exec();
      if (dto.enabled !== false) {
        this._activationNotifier.scheduleActivationNotify(String(created._id));
      }
      return this.toRow(lean as unknown as Record<string, unknown>);
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000) {
        throw new ConflictException('gift_code_exists');
      }
      throw e;
    }
  }

  async patch(
    user: UserModel,
    id: string,
    dto: PatchGiftCodeDto,
  ): Promise<GiftCodeApiRow> {
    await this.assertAdmin(user);
    const oid = new Types.ObjectId(id);
    const existing = await this._giftCodeModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('gift_code_not_found');
    }
    const wasEnabled = Boolean(existing.enabled);

    const nextType = dto.discountType ?? existing.discountType;
    const nextValue = dto.value ?? existing.value;
    this.validateValue(nextType, nextValue);

    if (dto.validFrom != null || dto.validUntil != null) {
      const nextFrom = dto.validFrom
        ? new Date(dto.validFrom)
        : (existing.validFrom as Date);
      const nextUntil = dto.validUntil
        ? new Date(dto.validUntil)
        : (existing.validUntil as Date);
      this.assertDateRange(nextFrom, nextUntil);
      if (dto.validFrom != null) existing.validFrom = nextFrom;
      if (dto.validUntil != null) existing.validUntil = nextUntil;
    }

    if (dto.code != null) {
      existing.code = dto.code.trim().toUpperCase();
    }
    if (dto.discountType != null) existing.discountType = dto.discountType;
    if (dto.promoType != null) existing.promoType = dto.promoType;
    if (dto.title != null) existing.title = dto.title.trim();
    if (dto.subtitle != null) existing.subtitle = dto.subtitle.trim();
    if (dto.imageUrl !== undefined) {
      existing.imageUrl =
        dto.imageUrl == null || !String(dto.imageUrl).trim()
          ? undefined
          : String(dto.imageUrl).trim();
    }
    if (dto.value != null) existing.value = dto.value;
    if (dto.enabled != null) existing.enabled = dto.enabled;
    if (dto.maxUses !== undefined) {
      existing.maxUses = dto.maxUses === null ? undefined : dto.maxUses;
    }
    if (dto.maxUsesPerUser !== undefined) {
      existing.maxUsesPerUser =
        dto.maxUsesPerUser === null ? undefined : dto.maxUsesPerUser;
    }

    if (dto.scopeType != null) {
      let storeOids = existing.storeIds ?? [];
      let regionCodes = (existing.regionCodes ?? []).map((c) =>
        String(c).toUpperCase(),
      );
      if (dto.scopeType === GiftCodeScopeTypeEnum.ALL) {
        storeOids = [];
        regionCodes = [];
      } else if (dto.scopeType === GiftCodeScopeTypeEnum.SPECIFIC) {
        storeOids =
          dto.storeIds != null
            ? await this.validateStoreIds(dto.storeIds)
            : existing.storeIds ?? [];
        if (!storeOids.length) {
          throw new BadRequestException('store_ids_required');
        }
        regionCodes = [];
      } else if (dto.scopeType === GiftCodeScopeTypeEnum.REGION) {
        regionCodes =
          dto.regionCodes != null
            ? await this.validateRegionCodes(dto.regionCodes)
            : (existing.regionCodes ?? []).map((c) => String(c).toUpperCase());
        if (!regionCodes.length) {
          throw new BadRequestException('region_codes_required');
        }
        storeOids = [];
      }
      this.applyScopeFields(existing, dto.scopeType, storeOids, regionCodes);
    } else {
      if (dto.storeIds != null) {
        existing.storeIds = await this.validateStoreIds(dto.storeIds);
      }
      if (dto.regionCodes != null) {
        existing.regionCodes = await this.validateRegionCodes(dto.regionCodes);
      }
    }

    try {
      await existing.save();
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000) {
        throw new ConflictException('gift_code_exists');
      }
      throw e;
    }

    const lean = await this._giftCodeModel.findById(oid).lean().exec();
    if (dto.enabled === true && !wasEnabled) {
      this._activationNotifier.scheduleActivationNotify(id);
    }
    return this.toRow(lean as unknown as Record<string, unknown>);
  }

  async remove(user: UserModel, id: string): Promise<void> {
    await this.assertAdmin(user);
    const oid = new Types.ObjectId(id);
    const res = await this._giftCodeModel.deleteOne({ _id: oid }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('gift_code_not_found');
    }
  }

  /** ——— Panier client (preview / checkout) ——— */

  computeDiscountForSubtotal(
    subtotal: number,
    discountType: GiftCodeDiscountTypeEnum,
    value: number,
  ): number {
    const s = Math.max(0, Number(subtotal) || 0);
    if (s <= 0) return 0;
    if (discountType === GiftCodeDiscountTypeEnum.FIXED) {
      return Math.min(Number(value) || 0, s);
    }
    const pct = Math.min(100, Math.max(0, Number(value) || 0));
    return Math.min(s, (s * pct) / 100);
  }

  private assertGiftCodeActive(doc: GiftCodeModel): void {
    if (!doc.enabled) {
      throw new BadRequestException('gift_code_invalid');
    }
    const now = new Date();
    if (now < doc.validFrom || now > doc.validUntil) {
      throw new BadRequestException('gift_code_expired');
    }
    if (doc.maxUses != null && doc.usedCount >= doc.maxUses) {
      throw new BadRequestException('gift_code_exhausted');
    }
  }

  private assertGiftCodeUserQuota(doc: GiftCodeModel, userId: string): void {
    if (doc.maxUsesPerUser == null) return;
    const uid = new Types.ObjectId(userId);
    const row = (doc.userUsages ?? []).find(
      (u) => String(u.userId) === String(uid),
    );
    if (row && row.count >= doc.maxUsesPerUser) {
      throw new BadRequestException('gift_code_user_limit_reached');
    }
  }

  isStoreEligibleForGiftCode(
    doc: GiftCodeModel,
    storeId: string,
    storeRegion?: string,
  ): boolean {
    if (doc.scopeType === GiftCodeScopeTypeEnum.ALL) return true;
    if (doc.scopeType === GiftCodeScopeTypeEnum.SPECIFIC) {
      return (doc.storeIds ?? []).some((id) => String(id) === storeId);
    }
    const region = normalizeCountryCode(storeRegion);
    if (!region) return false;
    return (doc.regionCodes ?? []).some(
      (c) => normalizeCountryCode(c) === region,
    );
  }

  async getActiveGiftCodeForUser(
    user: UserModel,
    rawCode: string,
  ): Promise<GiftCodeModel> {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('gift_code_required');
    }
    const doc = await this._giftCodeModel.findOne({ code }).exec();
    if (!doc) {
      throw new BadRequestException('gift_code_invalid');
    }
    this.assertGiftCodeActive(doc);
    this.assertGiftCodeUserQuota(doc, String(user.id));
    return doc;
  }

  previewForCart(
    user: UserModel,
    rawCode: string,
    stores: Array<{
      storeId: string;
      storeName: string;
      regionCode: string;
      subtotal: number;
      storeCouponDiscount: number;
    }>,
  ) {
    const docPromise = this.getActiveGiftCodeForUser(user, rawCode);
    return docPromise.then((doc) => {
      const code = doc.code;
      let cartSubtotal = 0;
      let eligibleSubtotal = 0;
      const breakdown: Array<{
        storeId: string;
        storeName: string;
        regionCode: string;
        eligible: boolean;
        ineligibleReason?: string;
        subtotal: number;
        storeCouponDiscount: number;
        subtotalAfterStoreCoupon: number;
        giftCodeDiscount: number;
      }> = [];

      for (const s of stores) {
        const subtotal = Math.max(0, Number(s.subtotal) || 0);
        const storeCouponDiscount = Math.max(
          0,
          Number(s.storeCouponDiscount) || 0,
        );
        const subtotalAfterStoreCoupon = Math.max(
          0,
          subtotal - storeCouponDiscount,
        );
        cartSubtotal += subtotalAfterStoreCoupon;
        const scopeEligible = this.isStoreEligibleForGiftCode(
          doc,
          s.storeId,
          s.regionCode,
        );
        let ineligibleReason: string | undefined;
        if (!scopeEligible) {
          if (doc.scopeType === GiftCodeScopeTypeEnum.REGION) {
            ineligibleReason = 'store_not_in_gift_code_region';
          } else if (doc.scopeType === GiftCodeScopeTypeEnum.SPECIFIC) {
            ineligibleReason = 'store_not_in_gift_code_scope';
          } else {
            ineligibleReason = 'store_not_eligible';
          }
        } else if (subtotalAfterStoreCoupon <= 0) {
          ineligibleReason = 'store_cart_empty';
        }
        const isEligible = scopeEligible && subtotalAfterStoreCoupon > 0;
        if (isEligible) {
          eligibleSubtotal += subtotalAfterStoreCoupon;
        }
        breakdown.push({
          storeId: s.storeId,
          storeName: s.storeName,
          regionCode: s.regionCode,
          eligible: isEligible,
          ineligibleReason: isEligible ? undefined : ineligibleReason,
          subtotal,
          storeCouponDiscount,
          subtotalAfterStoreCoupon,
          giftCodeDiscount: 0,
        });
      }

      if (eligibleSubtotal <= 0) {
        throw new BadRequestException('gift_code_no_eligible_items');
      }

      const discountAmount =
        Math.round(
          this.computeDiscountForSubtotal(
            eligibleSubtotal,
            doc.discountType,
            doc.value,
          ) * 100 + Number.EPSILON,
        ) / 100;
      const totalAfterDiscount = Math.max(
        0,
        Math.round((cartSubtotal - discountAmount) * 100 + Number.EPSILON) /
          100,
      );

      let allocated = 0;
      const eligibleRows = breakdown.filter((r) => r.eligible);
      for (let i = 0; i < eligibleRows.length; i++) {
        const row = eligibleRows[i]!;
        if (i === eligibleRows.length - 1) {
          row.giftCodeDiscount =
            Math.round((discountAmount - allocated) * 100 + Number.EPSILON) /
            100;
        } else {
          const share =
            eligibleSubtotal > 0
              ? (row.subtotalAfterStoreCoupon / eligibleSubtotal) *
                discountAmount
              : 0;
          row.giftCodeDiscount =
            Math.round(share * 100 + Number.EPSILON) / 100;
          allocated += row.giftCodeDiscount;
        }
      }

      const eligibleStoreCount = eligibleRows.length;
      const ineligibleStoreCount = breakdown.length - eligibleStoreCount;
      const summary =
        discountAmount > 0
          ? `Gift code ${code} appliqué : −${discountAmount.toFixed(2)} sur ${eligibleSubtotal.toFixed(2)} (${eligibleStoreCount} boutique${eligibleStoreCount > 1 ? 's' : ''} éligible${eligibleStoreCount > 1 ? 's' : ''}).`
          : `Gift code ${code} sans réduction applicable.`;

      return {
        code,
        discountType: doc.discountType,
        value: doc.value,
        scopeType: doc.scopeType,
        cartSubtotal:
          Math.round(cartSubtotal * 100 + Number.EPSILON) / 100,
        eligibleSubtotal:
          Math.round(eligibleSubtotal * 100 + Number.EPSILON) / 100,
        discountAmount,
        totalAfterDiscount,
        eligibleStoreCount,
        ineligibleStoreCount,
        storeBreakdown: breakdown,
        summary,
      };
    });
  }

  async recordUsageAfterSuccessfulPayment(
    userId: string,
    rawCode: string,
  ): Promise<void> {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!code) return;
    const doc = await this._giftCodeModel
      .findOne({ code, enabled: true })
      .exec();
    if (!doc) return;
    const now = new Date();
    if (now < doc.validFrom || now > doc.validUntil) return;
    if (doc.maxUses != null && doc.usedCount >= doc.maxUses) return;

    const uid = new Types.ObjectId(userId);
    const usages = doc.userUsages ?? [];
    const idx = usages.findIndex((u) => String(u.userId) === String(uid));
    if (doc.maxUsesPerUser != null) {
      const count = idx >= 0 ? usages[idx]!.count : 0;
      if (count >= doc.maxUsesPerUser) return;
    }

    const inc: Record<string, number> = { usedCount: 1 };
    const update: Record<string, unknown> = { $inc: inc };
    if (idx >= 0) {
      update.$inc = { ...inc, [`userUsages.${idx}.count`]: 1 };
    } else {
      update.$push = {
        userUsages: { userId: uid, count: 1 },
      };
    }
    await this._giftCodeModel.updateOne({ _id: doc._id }, update).exec();
  }

  /** Image promo catalogue → moteur Paramètres → Stockage (`marketing/gift-codes`). */
  async uploadPromoImage(
    user: UserModel,
    dto: GiftCodeImageJsonDto,
  ): Promise<{ url: string }> {
    await this.assertAdmin(user);
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
    const name = (dto.filename || 'gift-code-promo.jpg').trim() || 'gift-code-promo.jpg';
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
      buffer,
      originalname: name,
      mimetype: mime,
      size: buffer.length,
    } as Express.Multer.File;
    const url = await this._mediasService.upload(
      file,
      user,
      'marketing/gift-codes',
    );
    const resolved =
      (await this._mediasService.resolvePublicMediaUrl(url)) ?? url;
    return { url: resolved };
  }
}
