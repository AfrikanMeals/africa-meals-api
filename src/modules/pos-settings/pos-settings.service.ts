import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PosLicensePlanDocument,
  PosLicensePlanModel,
} from '@schemas/pos-license-plan.schema';
import {
  PosSettingsDocument,
  PosSettingsModel,
} from '@schemas/pos-settings.schema';
import {
  PosVendorLicenseDocument,
  PosVendorLicenseModel,
} from '@schemas/pos-vendor-license.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CreatePosLicensePlanDto,
  UpdatePosLicensePlanDto,
  UpsertPosVendorLicenseDto,
} from './dto/pos-license.dto';
import { UpdatePosDownloadsDto } from './dto/update-pos-downloads.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function mapPlan(row: Record<string, unknown>) {
  return {
    id: String(row._id ?? ''),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    priceMonthly: Number(row.priceMonthly) || 0,
    priceYearly: Number(row.priceYearly) || 0,
    currency: String(row.currency ?? 'CAD').toUpperCase(),
    parentStationCount: Math.max(1, Math.floor(Number(row.parentStationCount) || 1)),
    childStationsPerParent: Math.max(
      0,
      Math.floor(Number(row.childStationsPerParent) || 0),
    ),
    features: Array.isArray(row.features)
      ? row.features.map((f) => String(f)).filter(Boolean)
      : [],
    active: row.active !== false,
    sortOrder: Number(row.sortOrder) || 0,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : typeof row.createdAt === 'string'
          ? row.createdAt
          : null,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : typeof row.updatedAt === 'string'
          ? row.updatedAt
          : null,
  };
}

function mapVendorLicense(
  row: Record<string, unknown>,
  store?: Record<string, unknown> | null,
) {
  const storeDoc = store ?? (row.store as Record<string, unknown> | null);
  return {
    id: String(row._id ?? ''),
    storeId: storeDoc?._id
      ? String(storeDoc._id)
      : row.store
        ? String(row.store)
        : '',
    storeName: storeDoc?.name ? String(storeDoc.name) : '',
    priceMonthly: Number(row.priceMonthly) || 0,
    priceYearly: Number(row.priceYearly) || 0,
    currency: String(row.currency ?? 'CAD').toUpperCase(),
    parentStationCount: Math.max(1, Math.floor(Number(row.parentStationCount) || 1)),
    childStationsPerParent: Math.max(
      0,
      Math.floor(Number(row.childStationsPerParent) || 0),
    ),
    note: String(row.note ?? ''),
    active: row.active !== false,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : typeof row.updatedAt === 'string'
          ? row.updatedAt
          : null,
  };
}

@Injectable()
export class PosSettingsService {
  constructor(
    @InjectModel(PosSettingsModel.name)
    private readonly _settings: Model<PosSettingsDocument>,
    @InjectModel(PosLicensePlanModel.name)
    private readonly _plans: Model<PosLicensePlanDocument>,
    @InjectModel(PosVendorLicenseModel.name)
    private readonly _vendorLicenses: Model<PosVendorLicenseDocument>,
    @InjectModel(StoreModel.name)
    private readonly _stores: Model<StoreModel>,
  ) {}

  private _normalizeText(raw: string | undefined | null): string {
    return String(raw ?? '').trim();
  }

  private _downloadsFromDoc(doc: PosSettingsModel) {
    return {
      androidDownloadUrl: this._normalizeText(doc.androidDownloadUrl),
      iosDownloadUrl: this._normalizeText(doc.iosDownloadUrl),
      macosDownloadUrl: this._normalizeText(doc.macosDownloadUrl),
      windowsDownloadUrl: this._normalizeText(doc.windowsDownloadUrl),
    };
  }

  private async _ensureSettingsDoc() {
    return this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            androidDownloadUrl: '',
            iosDownloadUrl: '',
            macosDownloadUrl: '',
            windowsDownloadUrl: '',
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async getPublicCatalog() {
    const settingsDoc = await this._ensureSettingsDoc();
    const plans = await this._plans
      .find({ active: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    const typed = settingsDoc as unknown as { updatedAt?: Date };
    return {
      downloads: this._downloadsFromDoc(settingsDoc as PosSettingsModel),
      plans: plans.map((p) => mapPlan(p as Record<string, unknown>)),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getAdminOverview(user: UserModel) {
    assertAdmin(user);
    const settingsDoc = await this._ensureSettingsDoc();
    const [plans, vendorRows] = await Promise.all([
      this._plans.find().sort({ sortOrder: 1, createdAt: 1 }).lean().exec(),
      this._vendorLicenses
        .find()
        .populate({ path: 'store', select: 'name' })
        .sort({ updatedAt: -1 })
        .lean()
        .exec(),
    ]);
    const typed = settingsDoc as unknown as { updatedAt?: Date };
    return {
      downloads: this._downloadsFromDoc(settingsDoc as PosSettingsModel),
      plans: plans.map((p) => mapPlan(p as Record<string, unknown>)),
      vendorLicenses: vendorRows.map((row) =>
        mapVendorLicense(row as Record<string, unknown>),
      ),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async updateDownloads(user: UserModel, dto: UpdatePosDownloadsDto) {
    assertAdmin(user);
    const patch: Record<string, string> = {};
    if (dto.androidDownloadUrl !== undefined) {
      patch.androidDownloadUrl = this._normalizeText(dto.androidDownloadUrl);
    }
    if (dto.iosDownloadUrl !== undefined) {
      patch.iosDownloadUrl = this._normalizeText(dto.iosDownloadUrl);
    }
    if (dto.macosDownloadUrl !== undefined) {
      patch.macosDownloadUrl = this._normalizeText(dto.macosDownloadUrl);
    }
    if (dto.windowsDownloadUrl !== undefined) {
      patch.windowsDownloadUrl = this._normalizeText(dto.windowsDownloadUrl);
    }
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._downloadsFromDoc(updated);
  }

  async listPlans(user: UserModel, includeInactive = false) {
    assertAdmin(user);
    const filter = includeInactive ? {} : { active: true };
    const rows = await this._plans
      .find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    return { items: rows.map((p) => mapPlan(p as Record<string, unknown>)) };
  }

  async createPlan(user: UserModel, dto: CreatePosLicensePlanDto) {
    assertAdmin(user);
    const features = (dto.features ?? []).map((f) => f.trim()).filter(Boolean);
    const doc = await this._plans.create({
      name: dto.name.trim(),
      description: (dto.description ?? '').trim(),
      priceMonthly: dto.priceMonthly,
      priceYearly: dto.priceYearly,
      currency: (dto.currency ?? 'CAD').trim().toUpperCase() || 'CAD',
      parentStationCount: Math.max(1, Math.floor(dto.parentStationCount)),
      childStationsPerParent: Math.max(
        0,
        Math.floor(dto.childStationsPerParent),
      ),
      features,
      active: dto.active !== false,
      sortOrder: dto.sortOrder ?? 0,
    });
    return mapPlan(doc.toObject() as Record<string, unknown>);
  }

  async updatePlan(
    user: UserModel,
    planId: string,
    dto: UpdatePosLicensePlanDto,
  ) {
    assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('plan_not_found');
    }
    const patch: Record<string, unknown> = {};
    if (dto.name != null) patch.name = dto.name.trim();
    if (dto.description != null) patch.description = dto.description.trim();
    if (dto.priceMonthly != null) patch.priceMonthly = dto.priceMonthly;
    if (dto.priceYearly != null) patch.priceYearly = dto.priceYearly;
    if (dto.currency != null) {
      patch.currency = dto.currency.trim().toUpperCase() || 'CAD';
    }
    if (dto.parentStationCount != null) {
      patch.parentStationCount = Math.max(1, Math.floor(dto.parentStationCount));
    }
    if (dto.childStationsPerParent != null) {
      patch.childStationsPerParent = Math.max(
        0,
        Math.floor(dto.childStationsPerParent),
      );
    }
    if (dto.features != null) {
      patch.features = dto.features.map((f) => f.trim()).filter(Boolean);
    }
    if (dto.active != null) patch.active = dto.active;
    if (dto.sortOrder != null) patch.sortOrder = dto.sortOrder;

    const updated = await this._plans
      .findByIdAndUpdate(planId, { $set: patch }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('plan_not_found');
    return mapPlan(updated as Record<string, unknown>);
  }

  async deactivatePlan(user: UserModel, planId: string) {
    assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('plan_not_found');
    }
    const updated = await this._plans
      .findByIdAndUpdate(planId, { $set: { active: false } }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('plan_not_found');
    return mapPlan(updated as Record<string, unknown>);
  }

  async listVendorLicenses(user: UserModel) {
    assertAdmin(user);
    const rows = await this._vendorLicenses
      .find()
      .populate({ path: 'store', select: 'name' })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return {
      items: rows.map((row) =>
        mapVendorLicense(row as Record<string, unknown>),
      ),
    };
  }

  async upsertVendorLicense(
    user: UserModel,
    storeId: string,
    dto: UpsertPosVendorLicenseDto,
  ) {
    assertAdmin(user);
    if (!Types.ObjectId.isValid(storeId)) {
      throw new NotFoundException('store_not_found');
    }
    const store = await this._stores.findById(storeId).select('name').lean().exec();
    if (!store) throw new NotFoundException('store_not_found');

    const updated = await this._vendorLicenses
      .findOneAndUpdate(
        { store: new Types.ObjectId(storeId) },
        {
          $set: {
            store: new Types.ObjectId(storeId),
            priceMonthly: dto.priceMonthly,
            priceYearly: dto.priceYearly,
            currency: (dto.currency ?? 'CAD').trim().toUpperCase() || 'CAD',
            parentStationCount: Math.max(1, Math.floor(dto.parentStationCount)),
            childStationsPerParent: Math.max(
              0,
              Math.floor(dto.childStationsPerParent),
            ),
            note: (dto.note ?? '').trim(),
            active: dto.active !== false,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .populate({ path: 'store', select: 'name' })
      .lean()
      .exec();

    return mapVendorLicense(updated as Record<string, unknown>);
  }

  async deleteVendorLicense(user: UserModel, storeId: string) {
    assertAdmin(user);
    if (!Types.ObjectId.isValid(storeId)) {
      throw new NotFoundException('store_not_found');
    }
    const deleted = await this._vendorLicenses
      .findOneAndDelete({ store: new Types.ObjectId(storeId) })
      .exec();
    if (!deleted) throw new NotFoundException('vendor_license_not_found');
    return { ok: true };
  }
}
