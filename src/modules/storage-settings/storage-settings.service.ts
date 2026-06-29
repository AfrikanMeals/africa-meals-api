import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_STORAGE_ENGINES_ENABLED,
  StorageEnginesEnabled,
  StorageSettingsDocument,
  StorageSettingsModel,
  StorageEngineMode,
  StorageEngineId,
} from '@schemas/storage-settings.schema';
import {
  DEFAULT_MODULE_STORAGE_ENGINES,
  StorageModuleEngines,
  StorageModuleEngineSetting,
  StorageModuleId,
  STORAGE_MODULES,
  normalizeModuleStorageEngines,
} from '@schemas/storage-module.constants';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';

const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 5_000;

export type StorageSettingsResponse = {
  compressionEnabled: boolean;
  maxFileSizeMb: number;
  storageEngine: StorageEngineMode;
  fallbackStorageEngine: StorageEngineId | null;
  mediaProxyEnabled: boolean;
  enginesEnabled: StorageEnginesEnabled;
  moduleStorageEngines: StorageModuleEngines;
  updatedAt: string | null;
};

function normalizeEnginesEnabled(raw: unknown): StorageEnginesEnabled {
  const o =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    firebase: o.firebase !== false,
    gcs: o.gcs !== false,
    s3: o.s3 !== false,
    minio: o.minio !== false,
    r2: o.r2 !== false,
  };
}

function normalizeFallbackStorageEngine(raw: unknown): StorageEngineId | null {
  const ids: StorageEngineId[] = ['firebase', 'gcs', 's3', 'minio', 'r2'];
  return typeof raw === 'string' && ids.includes(raw as StorageEngineId)
    ? (raw as StorageEngineId)
    : null;
}

function assertFallbackStorageEngine(args: {
  storageEngine: StorageEngineMode;
  fallbackStorageEngine: StorageEngineId | null;
  enginesEnabled: StorageEnginesEnabled;
}) {
  const fallback = args.fallbackStorageEngine;
  if (!fallback) return;
  if (!args.enginesEnabled[fallback]) {
    throw new BadRequestException('storage_fallback_engine_disabled');
  }
  if (args.storageEngine !== 'auto' && args.storageEngine === fallback) {
    throw new BadRequestException('storage_fallback_engine_same_as_primary');
  }
}

function assertEnginesEnabledSettings(args: {
  storageEngine: StorageEngineMode;
  fallbackStorageEngine?: StorageEngineId | null;
  enginesEnabled: StorageEnginesEnabled;
  moduleStorageEngines?: StorageModuleEngines;
}) {
  const enabledIds = (
    ['firebase', 'gcs', 's3', 'minio', 'r2'] as StorageEngineId[]
  ).filter((id) => args.enginesEnabled[id]);
  if (enabledIds.length === 0) {
    throw new BadRequestException('storage_engine_none_enabled');
  }
  if (
    args.storageEngine !== 'auto' &&
    !args.enginesEnabled[args.storageEngine as StorageEngineId]
  ) {
    throw new BadRequestException('storage_engine_disabled');
  }
  if (args.moduleStorageEngines) {
    for (const module of STORAGE_MODULES) {
      const mode = args.moduleStorageEngines[module];
      if (
        mode !== 'default' &&
        mode !== 'auto' &&
        !args.enginesEnabled[mode as StorageEngineId]
      ) {
        throw new BadRequestException('storage_module_engine_disabled');
      }
    }
  }
  assertFallbackStorageEngine({
    storageEngine: args.storageEngine,
    fallbackStorageEngine: args.fallbackStorageEngine ?? null,
    enginesEnabled: args.enginesEnabled,
  });
}

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class StorageSettingsService {
  private cache: StorageSettingsResponse | null = null;
  private cacheExpiresAt = 0;

  constructor(
    @InjectModel(StorageSettingsModel.name)
    private readonly _settings: Model<StorageSettingsDocument>,
  ) {}

  private _toResponse(doc: StorageSettingsModel): StorageSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    const maxMb = Number(doc.maxFileSizeMb);
    return {
      compressionEnabled: doc.compressionEnabled === true,
      maxFileSizeMb:
        Number.isFinite(maxMb) && maxMb >= 1 && maxMb <= 50
          ? Math.trunc(maxMb)
          : 5,
      storageEngine: (doc.storageEngine as StorageEngineMode) || 'firebase',
      fallbackStorageEngine: normalizeFallbackStorageEngine(
        doc.fallbackStorageEngine,
      ),
      mediaProxyEnabled: doc.mediaProxyEnabled === true,
      enginesEnabled: normalizeEnginesEnabled(doc.enginesEnabled),
      moduleStorageEngines: normalizeModuleStorageEngines(
        doc.moduleStorageEngines,
      ),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  private invalidateCache() {
    this.cache = null;
    this.cacheExpiresAt = 0;
  }

  async getPublicSettings(): Promise<StorageSettingsResponse> {
    const now = Date.now();
    if (this.cache && now < this.cacheExpiresAt) {
      return this.cache;
    }
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            compressionEnabled: false,
            maxFileSizeMb: 5,
            storageEngine: 'firebase',
            fallbackStorageEngine: null,
            mediaProxyEnabled: false,
            enginesEnabled: { ...DEFAULT_STORAGE_ENGINES_ENABLED },
            moduleStorageEngines: { ...DEFAULT_MODULE_STORAGE_ENGINES },
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    const response = this._toResponse(doc as StorageSettingsModel);
    this.cache = response;
    this.cacheExpiresAt = now + CACHE_TTL_MS;
    return response;
  }

  async getMaxFileSizeBytes(): Promise<number> {
    const settings = await this.getPublicSettings();
    return settings.maxFileSizeMb * 1024 * 1024;
  }

  /** Moteur effectif pour un module (override ou moteur global). */
  async resolveEngineForModule(
    module: StorageModuleId,
  ): Promise<StorageEngineMode> {
    const settings = await this.getPublicSettings();
    return this.resolveEngineForModuleFromSettings(module, settings);
  }

  resolveEngineForModuleFromSettings(
    module: StorageModuleId,
    settings: Pick<StorageSettingsResponse, 'storageEngine' | 'moduleStorageEngines'>,
  ): StorageEngineMode {
    const moduleEngine: StorageModuleEngineSetting =
      settings.moduleStorageEngines?.[module] ?? 'default';
    if (moduleEngine === 'default') {
      return settings.storageEngine;
    }
    return moduleEngine;
  }

  async updateSettings(user: UserModel, dto: UpdateStorageSettingsDto) {
    assertAdmin(user);
    const enginesEnabled = normalizeEnginesEnabled(dto.enginesEnabled);
    const moduleStorageEngines = normalizeModuleStorageEngines(
      dto.moduleStorageEngines,
    );
    const fallbackStorageEngine =
      dto.fallbackStorageEngine === undefined
        ? null
        : normalizeFallbackStorageEngine(dto.fallbackStorageEngine);
    assertEnginesEnabledSettings({
      storageEngine: dto.storageEngine,
      fallbackStorageEngine,
      enginesEnabled,
      moduleStorageEngines,
    });
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            compressionEnabled: dto.compressionEnabled,
            maxFileSizeMb: dto.maxFileSizeMb,
            storageEngine: dto.storageEngine,
            fallbackStorageEngine,
            mediaProxyEnabled: dto.mediaProxyEnabled,
            enginesEnabled,
            moduleStorageEngines,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.invalidateCache();
    return this._toResponse(updated);
  }
}
