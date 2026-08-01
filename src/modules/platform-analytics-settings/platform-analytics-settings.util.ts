import type { PlatformAnalyticsSettingsModel } from '@schemas/platform-analytics-settings.schema';
import {
  DEFAULT_PLATFORM_ANALYTICS_ADMIN,
  DEFAULT_PLATFORM_ANALYTICS_MOBILE,
  DEFAULT_PLATFORM_ANALYTICS_WEB,
  PLATFORM_ANALYTICS_ADMIN_KEYS,
  PLATFORM_ANALYTICS_MOBILE_KEYS,
  PLATFORM_ANALYTICS_WEB_KEYS,
  type PlatformAnalyticsAdminFlags,
  type PlatformAnalyticsAdminKey,
  type PlatformAnalyticsMobileFlags,
  type PlatformAnalyticsMobileKey,
  type PlatformAnalyticsWebFlags,
  type PlatformAnalyticsWebKey,
} from './platform-analytics-settings.constants';

/**
 * Normalise un patch de flags : seul `false` explicite désactive ;
 * absent / non-booléen → défaut `true` (aligné feature-modules).
 */
export function normalizeAdminFlags(
  raw: Partial<Record<PlatformAnalyticsAdminKey, boolean>> | null | undefined,
): PlatformAnalyticsAdminFlags {
  const out = { ...DEFAULT_PLATFORM_ANALYTICS_ADMIN };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of PLATFORM_ANALYTICS_ADMIN_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

export function normalizeWebFlags(
  raw: Partial<Record<PlatformAnalyticsWebKey, boolean>> | null | undefined,
): PlatformAnalyticsWebFlags {
  const out = { ...DEFAULT_PLATFORM_ANALYTICS_WEB };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of PLATFORM_ANALYTICS_WEB_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

export function normalizeMobileFlags(
  raw: Partial<Record<PlatformAnalyticsMobileKey, boolean>> | null | undefined,
): PlatformAnalyticsMobileFlags {
  const out = { ...DEFAULT_PLATFORM_ANALYTICS_MOBILE };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of PLATFORM_ANALYTICS_MOBILE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

export function mergeAdminFlags(
  current: PlatformAnalyticsAdminFlags,
  patch: Partial<PlatformAnalyticsAdminFlags> | null | undefined,
): PlatformAnalyticsAdminFlags {
  if (!patch || typeof patch !== 'object') return current;
  const next = { ...current };
  for (const key of PLATFORM_ANALYTICS_ADMIN_KEYS) {
    const v = patch[key];
    if (typeof v === 'boolean') next[key] = v;
  }
  return next;
}

export function mergeWebFlags(
  current: PlatformAnalyticsWebFlags,
  patch: Partial<PlatformAnalyticsWebFlags> | null | undefined,
): PlatformAnalyticsWebFlags {
  if (!patch || typeof patch !== 'object') return current;
  const next = { ...current };
  for (const key of PLATFORM_ANALYTICS_WEB_KEYS) {
    const v = patch[key];
    if (typeof v === 'boolean') next[key] = v;
  }
  return next;
}

export function mergeMobileFlags(
  current: PlatformAnalyticsMobileFlags,
  patch: Partial<PlatformAnalyticsMobileFlags> | null | undefined,
): PlatformAnalyticsMobileFlags {
  if (!patch || typeof patch !== 'object') return current;
  const next = { ...current };
  for (const key of PLATFORM_ANALYTICS_MOBILE_KEYS) {
    const v = patch[key];
    if (typeof v === 'boolean') next[key] = v;
  }
  return next;
}

export type PlatformAnalyticsSettingsResponse = {
  admin: PlatformAnalyticsAdminFlags;
  web: PlatformAnalyticsWebFlags;
  mobile: PlatformAnalyticsMobileFlags;
  updatedAt: string | null;
};

export function toAnalyticsSettingsResponse(
  doc: PlatformAnalyticsSettingsModel & { updatedAt?: Date },
): PlatformAnalyticsSettingsResponse {
  return {
    admin: normalizeAdminFlags(doc.admin),
    web: normalizeWebFlags(doc.web),
    mobile: normalizeMobileFlags(doc.mobile),
    updatedAt: doc.updatedAt?.toISOString?.() ?? null,
  };
}

/** Fail-open / cold start — tout ON. */
export function defaultAnalyticsSettingsResponse(): PlatformAnalyticsSettingsResponse {
  return {
    admin: { ...DEFAULT_PLATFORM_ANALYTICS_ADMIN },
    web: { ...DEFAULT_PLATFORM_ANALYTICS_WEB },
    mobile: { ...DEFAULT_PLATFORM_ANALYTICS_MOBILE },
    updatedAt: null,
  };
}

/**
 * Combine flag plateforme + préférence utilisateur (mobile).
 * Les deux doivent être true pour collecter.
 */
export function isAnalyticsToolEnabled(
  platformFlag: boolean | undefined | null,
  userPref: boolean | undefined | null,
): boolean {
  // Absent plateforme → ON (fail-open) ; userPref false coupe toujours.
  const platformOn = platformFlag !== false;
  const userOn = userPref !== false;
  return platformOn && userOn;
}
