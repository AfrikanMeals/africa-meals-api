import {
  CreateStoreCouponDto,
  PatchStoreCouponDto,
} from '@modules/coupons/dto/store-coupon.dto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  StoreCouponDiscountTypeEnum,
  StoreCouponModel,
} from '@schemas/store-coupon.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

export type StoreCouponApiRow = {
  id: string;
  code: string;
  storeId: string;
  storeName: string;
  discountType: StoreCouponDiscountTypeEnum;
  value: number;
  validFrom: string;
  validUntil: string;
  enabled: boolean;
  usedCount: number;
  maxUses: number | null;
  createdAt?: string;
  updatedAt?: string;
};

@Injectable()
export class CouponsService {
  constructor(
    @InjectModel(StoreCouponModel.name)
    private readonly _couponModel: Model<StoreCouponModel>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
  ) {}

  /** Admin : toutes les boutiques. Vendeur : uniquement les siennes. */
  private async assertUserCanManageStore(
    user: UserModel,
    storeId: string,
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN) {
      return;
    }
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

  private assertVendorOrAdmin(user: UserModel) {
    if (
      user.type !== UserTypeEnum.ADMIN &&
      user.type !== UserTypeEnum.VENDOR
    ) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
  }

  private validateValue(
    discountType: StoreCouponDiscountTypeEnum,
    value: number,
  ) {
    if (discountType === StoreCouponDiscountTypeEnum.FIXED) {
      if (value < 0.01 || value > 999_999) {
        throw new BadRequestException('invalid_fixed_discount');
      }
    } else {
      if (value < 1 || value > 100) {
        throw new BadRequestException('invalid_percentage_discount');
      }
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

  private toRow(doc: Record<string, unknown>): StoreCouponApiRow {
    const id = String(doc._id ?? doc.id ?? '');
    const st = doc.store as
      | { _id?: Types.ObjectId; name?: string }
      | Types.ObjectId
      | string
      | undefined;
    let storeId = '';
    let storeName = '';
    if (st && typeof st === 'object' && '_id' in st) {
      storeId = (st._id as Types.ObjectId).toString();
      storeName = String((st as { name?: string }).name ?? '');
    } else if (st instanceof Types.ObjectId) {
      storeId = st.toString();
    } else if (typeof st === 'string') {
      storeId = st;
    }
    const vf = doc.validFrom as Date | string;
    const vu = doc.validUntil as Date | string;
    return {
      id,
      code: String(doc.code ?? ''),
      storeId,
      storeName,
      discountType: doc.discountType as StoreCouponDiscountTypeEnum,
      value: Number(doc.value ?? 0),
      validFrom: vf instanceof Date ? vf.toISOString() : String(vf),
      validUntil: vu instanceof Date ? vu.toISOString() : String(vu),
      enabled: Boolean(doc.enabled),
      usedCount: Number(doc.usedCount ?? 0),
      maxUses: doc.maxUses == null ? null : Number(doc.maxUses),
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

  private async vendorStoreIds(user: UserModel): Promise<Types.ObjectId[]> {
    const docs = await this._storeModel
      .find({ owner: user._id })
      .select('_id')
      .lean()
      .exec();
    return docs.map((d) => d._id as Types.ObjectId);
  }

  async listForUser(user: UserModel): Promise<StoreCouponApiRow[]> {
    this.assertVendorOrAdmin(user);
    if (user.type === UserTypeEnum.ADMIN) {
      const docs = await this._couponModel
        .find()
        .populate('store', 'name')
        .sort({ createdAt: -1 })
        .lean()
        .exec();
      return docs.map((d) => this.toRow(d as Record<string, unknown>));
    }
    const ids = await this.vendorStoreIds(user);
    if (!ids.length) {
      return [];
    }
    const docs = await this._couponModel
      .find({ store: { $in: ids } })
      .populate('store', 'name')
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return docs.map((d) => this.toRow(d as Record<string, unknown>));
  }

  async create(user: UserModel, dto: CreateStoreCouponDto): Promise<StoreCouponApiRow> {
    this.assertVendorOrAdmin(user);
    this.validateValue(dto.discountType, dto.value);
    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    this.assertDateRange(validFrom, validUntil);

    const store = await this._storeModel
      .findById(new Types.ObjectId(dto.storeId))
      .select('_id name owner')
      .lean()
      .exec();
    if (!store) {
      throw new NotFoundException('store_not_found');
    }
    await this.assertUserCanManageStore(user, dto.storeId);

    const code = dto.code.trim().toUpperCase();
    try {
      const created = await this._couponModel.create({
        code,
        store: new Types.ObjectId(dto.storeId),
        discountType: dto.discountType,
        value: dto.value,
        validFrom,
        validUntil,
        enabled: dto.enabled !== false,
        usedCount: 0,
        maxUses: dto.maxUses,
      });
      const populated = await this._couponModel
        .findById(created._id)
        .populate('store', 'name')
        .lean()
        .exec();
      return this.toRow(populated as unknown as Record<string, unknown>);
    } catch (e: unknown) {
      const codeDup = (e as { code?: number })?.code === 11000;
      if (codeDup) {
        throw new ConflictException('coupon_code_exists_for_store');
      }
      throw e;
    }
  }

  async patch(
    user: UserModel,
    id: string,
    dto: PatchStoreCouponDto,
  ): Promise<StoreCouponApiRow> {
    this.assertVendorOrAdmin(user);
    const oid = new Types.ObjectId(id);
    const existing = await this._couponModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('coupon_not_found');
    }
    const storeRef = existing.store as Types.ObjectId | { toString(): string };
    await this.assertUserCanManageStore(user, String(storeRef));

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
      if (dto.validFrom != null) {
        existing.validFrom = nextFrom;
      }
      if (dto.validUntil != null) {
        existing.validUntil = nextUntil;
      }
    }

    if (dto.code != null) {
      existing.code = dto.code.trim().toUpperCase();
    }
    if (dto.discountType != null) {
      existing.discountType = dto.discountType;
    }
    if (dto.value != null) {
      existing.value = dto.value;
    }
    if (dto.enabled != null) {
      existing.enabled = dto.enabled;
    }
    if (dto.maxUses !== undefined) {
      existing.maxUses = dto.maxUses === null ? undefined : dto.maxUses;
    }

    try {
      await existing.save();
    } catch (e: unknown) {
      if ((e as { code?: number })?.code === 11000) {
        throw new ConflictException('coupon_code_exists_for_store');
      }
      throw e;
    }

    const populated = await this._couponModel
      .findById(oid)
      .populate('store', 'name')
      .lean()
      .exec();
    return this.toRow(populated as unknown as Record<string, unknown>);
  }

  async remove(user: UserModel, id: string): Promise<void> {
    this.assertVendorOrAdmin(user);
    const oid = new Types.ObjectId(id);
    const existing = await this._couponModel.findById(oid).exec();
    if (!existing) {
      throw new NotFoundException('coupon_not_found');
    }
    const storeRef = existing.store as Types.ObjectId | { toString(): string };
    await this.assertUserCanManageStore(user, String(storeRef));

    const res = await this._couponModel.deleteOne({ _id: oid }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('coupon_not_found');
    }
  }
}
