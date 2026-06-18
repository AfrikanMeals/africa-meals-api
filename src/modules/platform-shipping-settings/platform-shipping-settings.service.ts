import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
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
  deliveryBasePrice: 0,
  maxDeliveryRadiusKm: 25,
  currency: 'CAD',
  ranges: [] as { minKm: number; maxKm: number; fee: number }[],
  deliveryWithheldFeeMode: 'percent' as PlatformFeeMode,
  deliveryWithheldFeeFixed: 0,
  deliveryWithheldFeePercent: 0,
  deliveryTipEnabled: false,
  deliveryTipMode: 'fixed' as PlatformFeeMode,
  deliveryTipFixed: 0,
  deliveryTipPercent: 0,
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

function inferTipMode(
  stored: string | undefined,
  fixed: number,
  percent: number,
): PlatformFeeMode {
  if (stored === 'percent' || stored === 'fixed') return stored;
  if (percent > 0 && fixed <= 0) return 'percent';
  if (fixed > 0 && percent <= 0) return 'fixed';
  return DEFAULTS.deliveryTipMode;
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
    private readonly _supportedCountries: SupportedCountriesService,
    @InjectModel(PlatformShippingSettingsModel.name)
    private readonly _model: Model<PlatformShippingSettingsDocument>,
  ) {}

  private async _resolveCurrency(
    stored?: string | null,
  ): Promise<string> {
    const normalized = String(stored ?? '')
      .trim()
      .toUpperCase();
    if (normalized) return normalized;
    return this._supportedCountries.getPrimaryBillingCurrency();
  }

  private async _assertActiveCurrency(currency: string): Promise<void> {
    const cur = String(currency ?? '')
      .trim()
      .toUpperCase();
    const rows = await this._supportedCountries.listActive();
    if (rows.some((row) => row.currency === cur)) return;
    throw new BadRequestException('invalid_currency');
  }

  private async _toResponse(doc: PlatformShippingSettingsModel) {
    const deliveryWithheldFeeMode = inferWithheldMode(
      doc.deliveryWithheldFeeMode,
      doc.deliveryWithheldFeeFixed ?? 0,
      doc.deliveryWithheldFeePercent ?? 0,
    );
    const deliveryTipMode = inferTipMode(
      doc.deliveryTipMode,
      doc.deliveryTipFixed ?? 0,
      doc.deliveryTipPercent ?? 0,
    );
    return {
      perKmRate: doc.perKmRate,
      deliveryBasePrice: doc.deliveryBasePrice ?? 0,
      maxDeliveryRadiusKm: doc.maxDeliveryRadiusKm,
      currency: await this._resolveCurrency(doc.currency),
      ranges: (doc.ranges ?? []).map((r) => ({
        minKm: r.minKm,
        maxKm: r.maxKm,
        fee: r.fee,
      })),
      deliveryWithheldFeeMode,
      deliveryWithheldFeeFixed: doc.deliveryWithheldFeeFixed ?? 0,
      deliveryWithheldFeePercent: doc.deliveryWithheldFeePercent ?? 0,
      deliveryTipEnabled: doc.deliveryTipEnabled ?? false,
      deliveryTipMode,
      deliveryTipFixed: doc.deliveryTipFixed ?? 0,
      deliveryTipPercent: doc.deliveryTipPercent ?? 0,
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
    const deliveryTipEnabled =
      dto.deliveryTipEnabled ?? current.deliveryTipEnabled;
    const deliveryTipMode = normalizeMode(
      dto.deliveryTipMode,
      current.deliveryTipMode,
    );
    const tipFixed = dto.deliveryTipFixed ?? current.deliveryTipFixed;
    const tipPercent = dto.deliveryTipPercent ?? current.deliveryTipPercent;
    const currency = String(dto.currency ?? current.currency)
      .trim()
      .toUpperCase();
    await this._assertActiveCurrency(currency);

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            perKmRate: dto.perKmRate,
            deliveryBasePrice: dto.deliveryBasePrice,
            maxDeliveryRadiusKm: dto.maxDeliveryRadiusKm,
            currency,
            ranges,
            deliveryWithheldFeeMode,
            deliveryWithheldFeeFixed:
              deliveryWithheldFeeMode === 'fixed' ? withheldFixed : 0,
            deliveryWithheldFeePercent:
              deliveryWithheldFeeMode === 'percent' ? withheldPercent : 0,
            deliveryTipEnabled,
            deliveryTipMode,
            deliveryTipFixed:
              deliveryTipMode === 'fixed' ? tipFixed : 0,
            deliveryTipPercent:
              deliveryTipMode === 'percent' ? tipPercent : 0,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
