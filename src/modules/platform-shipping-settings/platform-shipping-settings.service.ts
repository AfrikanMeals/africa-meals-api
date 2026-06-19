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
import {
  extractTipMapFromSettings,
  inferTipModeFromPresets,
  normalizePresetList,
  normalizeRegionCode,
  normalizeRegionShippingEntry,
  readMergedSettingsByRegion,
  resolveSettingsForRegion,
  resolveTipFieldsFromConfig,
} from './platform-shipping-region.util';

const SETTINGS_KEY = 'default';

const DEFAULTS = {
  perKmRate: 0,
  deliveryBasePrice: 0,
  maxDeliveryRadiusKm: 25,
  currency: 'CAD',
  ranges: [] as { minKm: number; maxKm: number; basePrice?: number; fee: number }[],
  deliveryWithheldFeeMode: 'percent' as PlatformFeeMode,
  deliveryWithheldFeeFixed: 0,
  deliveryWithheldFeePercent: 0,
  deliveryTipEnabled: false,
  deliveryTipMode: 'fixed' as PlatformFeeMode,
  deliveryTipFixed: 0,
  deliveryTipPercent: 0,
  deliveryTipPresets: [] as number[],
  deliveryTipFixedPresets: [] as number[],
  deliveryTipPercentPresets: [] as number[],
  deliveryTipByRegion: {} as Record<string, unknown>,
  settingsByRegion: {} as Record<string, unknown>,
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

function normalizeRanges(
  ranges: { minKm: number; maxKm: number; basePrice?: number; fee: number }[],
): { minKm: number; maxKm: number; basePrice?: number; fee: number }[] {
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
    if (r.basePrice != null && !Number.isFinite(r.basePrice)) {
      throw new BadRequestException('invalid_range_numbers');
    }
    if (r.basePrice != null && r.basePrice < 0) {
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

@Injectable()
export class PlatformShippingSettingsService {
  constructor(
    private readonly _supportedCountries: SupportedCountriesService,
    @InjectModel(PlatformShippingSettingsModel.name)
    private readonly _model: Model<PlatformShippingSettingsDocument>,
  ) {}

  private async _resolveCurrency(stored?: string | null): Promise<string> {
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

  private async _assertActiveRegion(regionCode: string): Promise<void> {
    const code = normalizeRegionCode(regionCode);
    if (!code) throw new BadRequestException('invalid_country_code');
    const rows = await this._supportedCountries.listActive();
    if (rows.some((row) => row.code.toUpperCase() === code)) return;
    throw new BadRequestException('invalid_country_code');
  }

  private async _resolveRegionCurrency(
    regionCode?: string | null,
  ): Promise<string | null> {
    const code = normalizeRegionCode(regionCode);
    if (!code) return null;
    const rows = await this._supportedCountries.listActive();
    const row = rows.find((r) => r.code.toUpperCase() === code);
    return row?.currency?.trim().toUpperCase() ?? null;
  }

  private async _toResponse(
    doc: PlatformShippingSettingsModel,
    regionCode?: string | null,
  ) {
    const resolved = resolveSettingsForRegion(doc, regionCode);
    const settingsByRegion = readMergedSettingsByRegion(doc);
    const deliveryTipByRegion = extractTipMapFromSettings(settingsByRegion);
    const regionCurrency = await this._resolveRegionCurrency(regionCode);
    const tipFields = resolveTipFieldsFromConfig(resolved);
    return {
      perKmRate: resolved.perKmRate,
      deliveryBasePrice: resolved.deliveryBasePrice,
      maxDeliveryRadiusKm: resolved.maxDeliveryRadiusKm,
      currency:
        regionCurrency ?? (await this._resolveCurrency(doc.currency)),
      ranges: (resolved.ranges ?? []).map((r) => ({
        minKm: r.minKm,
        maxKm: r.maxKm,
        ...(r.basePrice != null ? { basePrice: r.basePrice } : {}),
        fee: r.fee,
      })),
      deliveryWithheldFeeMode: resolved.deliveryWithheldFeeMode,
      deliveryWithheldFeeFixed: resolved.deliveryWithheldFeeFixed,
      deliveryWithheldFeePercent: resolved.deliveryWithheldFeePercent,
      deliveryTipEnabled: resolved.deliveryTipEnabled,
      deliveryTipMode: tipFields.deliveryTipMode,
      deliveryTipFixed: tipFields.deliveryTipFixed,
      deliveryTipPercent: tipFields.deliveryTipPercent,
      deliveryTipPresets: tipFields.deliveryTipPresets,
      deliveryTipFixedPresets: tipFields.deliveryTipFixedPresets,
      deliveryTipPercentPresets: tipFields.deliveryTipPercentPresets,
      settingsByRegion,
      deliveryTipByRegion,
      resolvedRegionCode: normalizeRegionCode(regionCode),
      resolvedDeliveryTipRegionCode: normalizeRegionCode(regionCode),
      updatedAt:
        (doc as unknown as { updatedAt?: Date }).updatedAt?.toISOString?.() ??
        null,
    };
  }

  async getPublicSettings(regionCode?: string) {
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
    return this._toResponse(
      doc as PlatformShippingSettingsModel,
      regionCode,
    );
  }

  async updateSettings(
    user: UserModel,
    dto: UpdatePlatformShippingSettingsDto,
  ) {
    assertAdmin(user);
    const regionCode = normalizeRegionCode(
      dto.regionCode ?? dto.deliveryTipRegionCode,
    );
    const currentDoc = await this._model
      .findOne({ key: SETTINGS_KEY })
      .lean()
      .exec();
    const current = await this._toResponse(
      (currentDoc ?? { key: SETTINGS_KEY, ...DEFAULTS }) as PlatformShippingSettingsModel,
      regionCode ?? undefined,
    );

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
    let resolvedFixed = normalizePresetList(
      dto.deliveryTipFixedPresets ?? current.deliveryTipFixedPresets,
      false,
    );
    let resolvedPercent = normalizePresetList(
      dto.deliveryTipPercentPresets ?? current.deliveryTipPercentPresets,
      true,
    );
    if (
      dto.deliveryTipFixedPresets == null &&
      dto.deliveryTipPercentPresets == null &&
      Array.isArray(dto.deliveryTipPresets) &&
      dto.deliveryTipPresets.length
    ) {
      if (deliveryTipMode === 'percent') {
        resolvedPercent = normalizePresetList(dto.deliveryTipPresets, true);
        resolvedFixed = [];
      } else {
        resolvedFixed = normalizePresetList(dto.deliveryTipPresets, false);
        resolvedPercent = [];
      }
    }

    if (
      deliveryTipEnabled &&
      resolvedFixed.length === 0 &&
      resolvedPercent.length === 0
    ) {
      throw new BadRequestException('delivery_tip_presets_required');
    }

    const regionCurrency = regionCode
      ? await this._resolveRegionCurrency(regionCode)
      : null;
    const currency = String(
      regionCurrency ?? dto.currency ?? current.currency,
    )
      .trim()
      .toUpperCase();
    await this._assertActiveCurrency(currency);

    const regionEntry = normalizeRegionShippingEntry({
      perKmRate: dto.perKmRate,
      deliveryBasePrice: dto.deliveryBasePrice,
      maxDeliveryRadiusKm: dto.maxDeliveryRadiusKm,
      ranges,
      deliveryWithheldFeeMode,
      deliveryWithheldFeeFixed:
        deliveryWithheldFeeMode === 'fixed' ? withheldFixed : 0,
      deliveryWithheldFeePercent:
        deliveryWithheldFeeMode === 'percent' ? withheldPercent : 0,
      deliveryTipEnabled,
      deliveryTipFixedPresets: resolvedFixed,
      deliveryTipPercentPresets: resolvedPercent,
    });

    const $set: Record<string, unknown> = {};

    if (regionCode) {
      await this._assertActiveRegion(regionCode);
      const settingsByRegion = readMergedSettingsByRegion(
        (currentDoc ?? { key: SETTINGS_KEY, ...DEFAULTS }) as PlatformShippingSettingsModel,
      );
      settingsByRegion[regionCode] = regionEntry;
      $set.settingsByRegion = settingsByRegion;
      $set.deliveryTipByRegion = extractTipMapFromSettings(settingsByRegion);
    } else {
      $set.perKmRate = regionEntry.perKmRate;
      $set.deliveryBasePrice = regionEntry.deliveryBasePrice;
      $set.maxDeliveryRadiusKm = regionEntry.maxDeliveryRadiusKm;
      $set.currency = currency;
      $set.ranges = regionEntry.ranges;
      $set.deliveryWithheldFeeMode = regionEntry.deliveryWithheldFeeMode;
      $set.deliveryWithheldFeeFixed = regionEntry.deliveryWithheldFeeFixed;
      $set.deliveryWithheldFeePercent = regionEntry.deliveryWithheldFeePercent;
      $set.deliveryTipEnabled = regionEntry.deliveryTipEnabled;
      const resolvedTipMode = inferTipModeFromPresets(
        regionEntry.deliveryTipFixedPresets,
        regionEntry.deliveryTipPercentPresets,
        inferTipMode(deliveryTipMode, resolvedFixed[0] ?? 0, resolvedPercent[0] ?? 0),
      );
      $set.deliveryTipMode = resolvedTipMode;
      $set.deliveryTipFixed = resolvedFixed[0] ?? 0;
      $set.deliveryTipPercent = resolvedPercent[0] ?? 0;
      $set.deliveryTipPresets =
        resolvedTipMode === 'percent' ? resolvedPercent : resolvedFixed;
      $set.deliveryTipFixedPresets = resolvedFixed;
      $set.deliveryTipPercentPresets = resolvedPercent;
    }

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated, regionCode);
  }
}
