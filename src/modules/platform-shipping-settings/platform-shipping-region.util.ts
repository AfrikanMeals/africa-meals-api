import { PlatformFeeMode } from '@schemas/platform-shipping-settings.schema';

export type RegionShippingRange = {
  minKm: number;
  maxKm: number;
  /** Prix de base propre à la tranche ; absent = repli sur deliveryBasePrice global. */
  basePrice?: number;
  fee: number;
};

/** Configuration livraison plateforme scoped par région (ISO2). */
export type RegionShippingConfig = {
  perKmRate: number;
  deliveryBasePrice: number;
  maxDeliveryRadiusKm: number;
  ranges: RegionShippingRange[];
  deliveryWithheldFeeMode: PlatformFeeMode;
  deliveryWithheldFeeFixed: number;
  deliveryWithheldFeePercent: number;
  deliveryTipEnabled: boolean;
  deliveryTipFixedPresets: number[];
  deliveryTipPercentPresets: number[];
};

export type ResolvedRegionShippingSettings = RegionShippingConfig & {
  deliveryTipMode: PlatformFeeMode;
  deliveryTipFixed: number;
  deliveryTipPercent: number;
  deliveryTipPresets: number[];
};

const MAX_TIP_PRESETS = 8;

export function normalizeRegionCode(raw?: string | null): string | null {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function normalizePresetList(
  raw: number[] | undefined,
  percentMode: boolean,
): number[] {
  const values = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) continue;
    if (percentMode && n > 100) continue;
    const key = n.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Math.round(n * 10000) / 10000);
  }
  out.sort((a, b) => a - b);
  return out.slice(0, MAX_TIP_PRESETS);
}

function normalizeMode(
  raw: unknown,
  fallback: PlatformFeeMode,
): PlatformFeeMode {
  return raw === 'percent' || raw === 'fixed' ? raw : fallback;
}

function normalizeRanges(
  raw: unknown,
): RegionShippingRange[] {
  if (!Array.isArray(raw)) return [];
  const out: RegionShippingRange[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const minKm = Number(o.minKm);
    const maxKm = Number(o.maxKm);
    const fee = Number(o.fee);
    if (
      !Number.isFinite(minKm) ||
      !Number.isFinite(maxKm) ||
      !Number.isFinite(fee) ||
      minKm < 0 ||
      maxKm <= minKm ||
      fee < 0
    ) {
      continue;
    }
    const baseRaw = o.basePrice;
    const entry: RegionShippingRange = { minKm, maxKm, fee };
    if (baseRaw !== undefined && baseRaw !== null && baseRaw !== '') {
      const basePrice = Number(baseRaw);
      if (!Number.isFinite(basePrice) || basePrice < 0) continue;
      entry.basePrice = basePrice;
    }
    out.push(entry);
  }
  return out.sort((a, b) => a.minKm - b.minKm);
}

export function normalizeRegionShippingEntry(
  raw: unknown,
): RegionShippingConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const fixedPresets = normalizePresetList(
    Array.isArray(o.deliveryTipFixedPresets)
      ? (o.deliveryTipFixedPresets as number[])
      : [],
    false,
  );
  const percentPresets = normalizePresetList(
    Array.isArray(o.deliveryTipPercentPresets)
      ? (o.deliveryTipPercentPresets as number[])
      : [],
    true,
  );
  const withheldMode = normalizeMode(o.deliveryWithheldFeeMode, 'percent');
  return {
    perKmRate: Math.max(0, Number(o.perKmRate) || 0),
    deliveryBasePrice: Math.max(0, Number(o.deliveryBasePrice) || 0),
    maxDeliveryRadiusKm: Math.max(0.1, Number(o.maxDeliveryRadiusKm) || 25),
    ranges: normalizeRanges(o.ranges),
    deliveryWithheldFeeMode: withheldMode,
    deliveryWithheldFeeFixed:
      withheldMode === 'fixed'
        ? Math.max(0, Number(o.deliveryWithheldFeeFixed) || 0)
        : 0,
    deliveryWithheldFeePercent:
      withheldMode === 'percent'
        ? Math.max(0, Number(o.deliveryWithheldFeePercent) || 0)
        : 0,
    deliveryTipEnabled: o.deliveryTipEnabled === true,
    deliveryTipFixedPresets: fixedPresets,
    deliveryTipPercentPresets: percentPresets,
  };
}

export function readSettingsByRegion(
  raw: unknown,
): Record<string, RegionShippingConfig> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, RegionShippingConfig> = {};
  const entries =
    raw instanceof Map
      ? [...raw.entries()]
      : Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries) {
    const code = normalizeRegionCode(String(key));
    if (!code) continue;
    out[code] = normalizeRegionShippingEntry(value);
  }
  return out;
}

export function inferTipModeFromPresets(
  fixedPresets: number[],
  percentPresets: number[],
  fallback: PlatformFeeMode,
): PlatformFeeMode {
  if (fixedPresets.length && percentPresets.length) return 'fixed';
  if (percentPresets.length) return 'percent';
  if (fixedPresets.length) return 'fixed';
  return fallback;
}

export function resolveTipFieldsFromConfig(
  config: RegionShippingConfig,
): Pick<
  ResolvedRegionShippingSettings,
  | 'deliveryTipMode'
  | 'deliveryTipFixed'
  | 'deliveryTipPercent'
  | 'deliveryTipPresets'
  | 'deliveryTipFixedPresets'
  | 'deliveryTipPercentPresets'
> {
  const deliveryTipMode = inferTipModeFromPresets(
    config.deliveryTipFixedPresets,
    config.deliveryTipPercentPresets,
    'fixed',
  );
  const legacyPresets =
    deliveryTipMode === 'percent'
      ? config.deliveryTipPercentPresets
      : config.deliveryTipFixedPresets;
  return {
    deliveryTipMode,
    deliveryTipFixed: config.deliveryTipFixedPresets[0] ?? 0,
    deliveryTipPercent: config.deliveryTipPercentPresets[0] ?? 0,
    deliveryTipPresets: legacyPresets,
    deliveryTipFixedPresets: config.deliveryTipFixedPresets,
    deliveryTipPercentPresets: config.deliveryTipPercentPresets,
  };
}

export function buildGlobalRegionConfig(doc: {
  perKmRate?: number;
  deliveryBasePrice?: number;
  maxDeliveryRadiusKm?: number;
  ranges?: RegionShippingRange[];
  deliveryWithheldFeeMode?: string;
  deliveryWithheldFeeFixed?: number;
  deliveryWithheldFeePercent?: number;
  deliveryTipEnabled?: boolean;
  deliveryTipMode?: string;
  deliveryTipFixed?: number;
  deliveryTipPercent?: number;
  deliveryTipPresets?: number[];
  deliveryTipFixedPresets?: number[];
  deliveryTipPercentPresets?: number[];
}): RegionShippingConfig {
  const deliveryTipMode =
    doc.deliveryTipMode === 'percent' || doc.deliveryTipMode === 'fixed'
      ? doc.deliveryTipMode
      : 'fixed';
  let fixedPresets = normalizePresetList(doc.deliveryTipFixedPresets, false);
  let percentPresets = normalizePresetList(doc.deliveryTipPercentPresets, true);
  if (!fixedPresets.length && !percentPresets.length) {
    const legacy = normalizePresetList(doc.deliveryTipPresets, false);
    if (deliveryTipMode === 'percent') {
      percentPresets = normalizePresetList(doc.deliveryTipPresets, true);
      if (!percentPresets.length && (doc.deliveryTipPercent ?? 0) > 0) {
        percentPresets = [doc.deliveryTipPercent!];
      }
    } else {
      fixedPresets = legacy.length ? legacy : [];
      if (!fixedPresets.length && (doc.deliveryTipFixed ?? 0) > 0) {
        fixedPresets = [doc.deliveryTipFixed!];
      }
    }
  }
  const withheldMode = normalizeMode(doc.deliveryWithheldFeeMode, 'percent');
  return normalizeRegionShippingEntry({
    perKmRate: doc.perKmRate,
    deliveryBasePrice: doc.deliveryBasePrice,
    maxDeliveryRadiusKm: doc.maxDeliveryRadiusKm,
    ranges: doc.ranges,
    deliveryWithheldFeeMode: withheldMode,
    deliveryWithheldFeeFixed: doc.deliveryWithheldFeeFixed,
    deliveryWithheldFeePercent: doc.deliveryWithheldFeePercent,
    deliveryTipEnabled: doc.deliveryTipEnabled,
    deliveryTipFixedPresets: fixedPresets,
    deliveryTipPercentPresets: percentPresets,
  });
}

/** Fusionne l’ancienne map tips-only dans settingsByRegion. */
export function mergeLegacyTipMapIntoSettings(
  settingsByRegion: Record<string, RegionShippingConfig>,
  tipByRegionRaw: unknown,
  globalFallback: RegionShippingConfig,
): Record<string, RegionShippingConfig> {
  const out = { ...settingsByRegion };
  if (!tipByRegionRaw || typeof tipByRegionRaw !== 'object') return out;
  const entries =
    tipByRegionRaw instanceof Map
      ? [...tipByRegionRaw.entries()]
      : Object.entries(tipByRegionRaw as Record<string, unknown>);
  for (const [key, value] of entries) {
    const code = normalizeRegionCode(String(key));
    if (!code) continue;
    const tip = normalizeRegionShippingEntry({
      ...globalFallback,
      ...(value as Record<string, unknown>),
      perKmRate: out[code]?.perKmRate ?? globalFallback.perKmRate,
      deliveryBasePrice:
        out[code]?.deliveryBasePrice ?? globalFallback.deliveryBasePrice,
      maxDeliveryRadiusKm:
        out[code]?.maxDeliveryRadiusKm ?? globalFallback.maxDeliveryRadiusKm,
      ranges: out[code]?.ranges ?? globalFallback.ranges,
      deliveryWithheldFeeMode:
        out[code]?.deliveryWithheldFeeMode ??
        globalFallback.deliveryWithheldFeeMode,
      deliveryWithheldFeeFixed:
        out[code]?.deliveryWithheldFeeFixed ??
        globalFallback.deliveryWithheldFeeFixed,
      deliveryWithheldFeePercent:
        out[code]?.deliveryWithheldFeePercent ??
        globalFallback.deliveryWithheldFeePercent,
    });
    out[code] = out[code]
      ? {
          ...out[code],
          deliveryTipEnabled: tip.deliveryTipEnabled,
          deliveryTipFixedPresets: tip.deliveryTipFixedPresets,
          deliveryTipPercentPresets: tip.deliveryTipPercentPresets,
        }
      : tip;
  }
  return out;
}

export function extractTipMapFromSettings(
  settingsByRegion: Record<string, RegionShippingConfig>,
): Record<
  string,
  {
    deliveryTipEnabled: boolean;
    deliveryTipFixedPresets: number[];
    deliveryTipPercentPresets: number[];
  }
> {
  const out: Record<
    string,
    {
      deliveryTipEnabled: boolean;
      deliveryTipFixedPresets: number[];
      deliveryTipPercentPresets: number[];
    }
  > = {};
  for (const [code, cfg] of Object.entries(settingsByRegion)) {
    out[code] = {
      deliveryTipEnabled: cfg.deliveryTipEnabled,
      deliveryTipFixedPresets: cfg.deliveryTipFixedPresets,
      deliveryTipPercentPresets: cfg.deliveryTipPercentPresets,
    };
  }
  return out;
}

export function resolveSettingsForRegion(
  doc: {
    perKmRate?: number;
    deliveryBasePrice?: number;
    maxDeliveryRadiusKm?: number;
    currency?: string;
    ranges?: RegionShippingRange[];
    deliveryWithheldFeeMode?: string;
    deliveryWithheldFeeFixed?: number;
    deliveryWithheldFeePercent?: number;
    deliveryTipEnabled?: boolean;
    deliveryTipMode?: string;
    deliveryTipFixed?: number;
    deliveryTipPercent?: number;
    deliveryTipPresets?: number[];
    deliveryTipFixedPresets?: number[];
    deliveryTipPercentPresets?: number[];
    deliveryTipByRegion?: unknown;
    settingsByRegion?: unknown;
  },
  regionCode?: string | null,
): ResolvedRegionShippingSettings {
  const global = buildGlobalRegionConfig(doc);
  let map = readSettingsByRegion(doc.settingsByRegion);
  map = mergeLegacyTipMapIntoSettings(map, doc.deliveryTipByRegion, global);
  const code = normalizeRegionCode(regionCode);
  const config = code && map[code] ? map[code] : global;
  return {
    ...config,
    ...resolveTipFieldsFromConfig(config),
  };
}

export function readMergedSettingsByRegion(doc: {
  perKmRate?: number;
  deliveryBasePrice?: number;
  maxDeliveryRadiusKm?: number;
  ranges?: RegionShippingRange[];
  deliveryWithheldFeeMode?: string;
  deliveryWithheldFeeFixed?: number;
  deliveryWithheldFeePercent?: number;
  deliveryTipEnabled?: boolean;
  deliveryTipMode?: string;
  deliveryTipFixed?: number;
  deliveryTipPercent?: number;
  deliveryTipPresets?: number[];
  deliveryTipFixedPresets?: number[];
  deliveryTipPercentPresets?: number[];
  deliveryTipByRegion?: unknown;
  settingsByRegion?: unknown;
}): Record<string, RegionShippingConfig> {
  const global = buildGlobalRegionConfig(doc);
  let map = readSettingsByRegion(doc.settingsByRegion);
  return mergeLegacyTipMapIntoSettings(map, doc.deliveryTipByRegion, global);
}
