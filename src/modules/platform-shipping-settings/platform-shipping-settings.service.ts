import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformFeeMode,
  PlatformShippingSettingsDocument,
  PlatformShippingSettingsModel,
} from '@schemas/platform-shipping-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdatePlatformShippingSettingsDto } from './dto/platform-shipping-settings.dto';

const SETTINGS_KEY = 'default';

const DEFAULTS = {
  perKmRate: 0,
  maxDeliveryRadiusKm: 25,
  ranges: [] as { minKm: number; maxKm: number; fee: number }[],
  deliveryWithheldFeeMode: 'percent' as PlatformFeeMode,
  deliveryWithheldFeeFixed: 0,
  deliveryWithheldFeePercent: 0,
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeMode(
  raw: string | undefined,
  fallback: PlatformFeeMode,
): PlatformFeeMode {
  return raw === 'percent' || raw === 'fixed' ? raw : fallback;
}

function inferWithheldMode(
  stored: string | undefined,
  fixed: number,
  percent: number,
): PlatformFeeMode {
  if (stored === 'percent' || stored === 'fixed') return stored;
  if (percent > 0 && fixed <= 0) return 'percent';
  if (fixed > 0 && percent <= 0) return 'fixed';
  return DEFAULTS.deliveryWithheldFeeMode;
}

function normalizeRanges(
  ranges: { minKm: number; maxKm: number; fee: number }[],
): { minKm: number; maxKm: number; fee: number }[] {
  const sorted = [...ranges].sort((a, b) => a.minKm - b.minKm);
  for (const r of sorted) {
    if (
      !(
        Number.isFinite(r.minKm) &&
        Number.isFinite(r.maxKm) &&
        Number.isFinite(r.fee)
      )
    ) {
      throw new BadRequestException('invalid_range_numbers');
    }
    if (r.minKm < 0 || r.maxKm <= r.minKm) {
      throw new BadRequestException('invalid_range_bounds');
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minKm < sorted[i - 1].maxKm) {
      throw new BadRequestException('shipping_ranges_overlap');
    }
  }
  return sorted;
}

@Injectable()
export class PlatformShippingSettingsService {
  constructor(
    @InjectModel(PlatformShippingSettingsModel.name)
    private readonly _model: Model<PlatformShippingSettingsDocument>,
  ) {}

  private _toResponse(doc: PlatformShippingSettingsModel) {
    const deliveryWithheldFeeMode = inferWithheldMode(
      doc.deliveryWithheldFeeMode,
      doc.deliveryWithheldFeeFixed ?? 0,
      doc.deliveryWithheldFeePercent ?? 0,
    );
    return {
      perKmRate: doc.perKmRate,
      maxDeliveryRadiusKm: doc.maxDeliveryRadiusKm,
      ranges: (doc.ranges ?? []).map((r) => ({
        minKm: r.minKm,
        maxKm: r.maxKm,
        fee: r.fee,
      })),
      deliveryWithheldFeeMode,
      deliveryWithheldFeeFixed: doc.deliveryWithheldFeeFixed ?? 0,
      deliveryWithheldFeePercent: doc.deliveryWithheldFeePercent ?? 0,
      updatedAt:
        (doc as unknown as { updatedAt?: Date }).updatedAt?.toISOString?.() ??
        null,
    };
  }

  async getPublicSettings() {
    const doc = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            ...DEFAULTS,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as PlatformShippingSettingsModel);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdatePlatformShippingSettingsDto,
  ) {
    assertAdmin(user);
    const current = await this.getPublicSettings();
    const ranges = normalizeRanges(dto.ranges ?? []);
    if (dto.maxDeliveryRadiusKm > 0 && ranges.length > 0) {
      const maxRangeEnd = Math.max(...ranges.map((r) => r.maxKm));
      if (maxRangeEnd > dto.maxDeliveryRadiusKm + 1e-6) {
        throw new BadRequestException('range_exceeds_max_radius');
      }
    }

    const deliveryWithheldFeeMode = normalizeMode(
      dto.deliveryWithheldFeeMode,
      current.deliveryWithheldFeeMode,
    );
    const withheldFixed =
      dto.deliveryWithheldFeeFixed ?? current.deliveryWithheldFeeFixed;
    const withheldPercent =
      dto.deliveryWithheldFeePercent ?? current.deliveryWithheldFeePercent;

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            perKmRate: dto.perKmRate,
            maxDeliveryRadiusKm: dto.maxDeliveryRadiusKm,
            ranges,
            deliveryWithheldFeeMode,
            deliveryWithheldFeeFixed:
              deliveryWithheldFeeMode === 'fixed' ? withheldFixed : 0,
            deliveryWithheldFeePercent:
              deliveryWithheldFeeMode === 'percent' ? withheldPercent : 0,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
