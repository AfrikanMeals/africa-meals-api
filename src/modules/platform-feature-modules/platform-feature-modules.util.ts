import {
  DEFAULT_PLATFORM_SURFACE_MODULES,
  PLATFORM_FEATURE_MODULE_KEYS,
  type PlatformFeatureModuleKey,
  type PlatformSurfaceModules,
} from './platform-feature-modules.constants';
import type { PlatformFeatureModulesModel } from '@schemas/platform-feature-modules.schema';

export function normalizeSurfaceModules(
  raw: Partial<Record<PlatformFeatureModuleKey, boolean>> | null | undefined,
): PlatformSurfaceModules {
  const out = { ...DEFAULT_PLATFORM_SURFACE_MODULES };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of PLATFORM_FEATURE_MODULE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

export function mergeSurfaceModules(
  current: PlatformSurfaceModules,
  patch: Partial<PlatformSurfaceModules> | null | undefined,
): PlatformSurfaceModules {
  if (!patch || typeof patch !== 'object') return current;
  const next = { ...current };
  for (const key of PLATFORM_FEATURE_MODULE_KEYS) {
    const v = patch[key as PlatformFeatureModuleKey];
    if (typeof v === 'boolean') next[key] = v;
  }
  return next;
}

export type PlatformFeatureModulesResponse = {
  admin: PlatformSurfaceModules;
  mobile: PlatformSurfaceModules;
  updatedAt: string | null;
};

export function toFeatureModulesResponse(
  doc: PlatformFeatureModulesModel & { updatedAt?: Date },
): PlatformFeatureModulesResponse {
  return {
    admin: normalizeSurfaceModules(doc.admin),
    mobile: normalizeSurfaceModules(doc.mobile),
    updatedAt: doc.updatedAt?.toISOString?.() ?? null,
  };
}
