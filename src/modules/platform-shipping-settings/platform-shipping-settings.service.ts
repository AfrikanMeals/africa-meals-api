import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformShippingSettingsModel,
  PlatformShippingSettingsDocument,
} from '@schemas/platform-shipping-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdatePlatformShippingSettingsDto } from './dto/platform-shipping-settings.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function normalizeRanges(
  ranges: { minKm: number; maxKm: number; fee: number }[],
): { minKm: number; maxKm: number; fee: number }[] {
  const sorted = [...ranges].sort((a, b) => a.minKm - b.minKm);
  for (const r of sorted) {
    if (!(Number.isFinite(r.minKm) && Number.isFinite(r.maxKm) && Number.isFinite(r.fee))) {
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
    return {
      perKmRate: doc.perKmRate,
      maxDeliveryRadiusKm: doc.maxDeliveryRadiusKm,
      ranges: (doc.ranges ?? []).map((r) => ({
        minKm: r.minKm,
        maxKm: r.maxKm,
        fee: r.fee,
      })),
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
            perKmRate: 0,
            maxDeliveryRadiusKm: 25,
            ranges: [],
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as PlatformShippingSettingsModel);
  }

  async updateSettings(user: UserModel, dto: UpdatePlatformShippingSettingsDto) {
    assertAdmin(user);
    const ranges = normalizeRanges(dto.ranges ?? []);
    if (dto.maxDeliveryRadiusKm > 0 && ranges.length > 0) {
      const maxRangeEnd = Math.max(...ranges.map((r) => r.maxKm));
      if (maxRangeEnd > dto.maxDeliveryRadiusKm + 1e-6) {
        throw new BadRequestException('range_exceeds_max_radius');
      }
    }
    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            perKmRate: dto.perKmRate,
            maxDeliveryRadiusKm: dto.maxDeliveryRadiusKm,
            ranges,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
