import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformFeatureModulesDocument,
  PlatformFeatureModulesModel,
} from '@schemas/platform-feature-modules.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdatePlatformFeatureModulesDto } from './dto/update-platform-feature-modules.dto';
import {
  DEFAULT_PLATFORM_SURFACE_MODULES,
  type PlatformSurfaceModules,
} from './platform-feature-modules.constants';
import {
  defaultFeatureModulesResponse,
  mergeSurfaceModules,
  normalizeSurfaceModules,
  PlatformFeatureModulesResponse,
  toFeatureModulesResponse,
} from './platform-feature-modules.util';

const SETTINGS_KEY = 'default';

const CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.PLATFORM_FEATURE_MODULES_CACHE_TTL_MS) || 300_000,
);

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class PlatformFeatureModulesService implements OnModuleInit {
  private readonly _logger = new Logger(PlatformFeatureModulesService.name);
  private _cache: PlatformFeatureModulesResponse | null = null;
  private _cacheAt = 0;
  private _seedInFlight: Promise<void> | null = null;

  constructor(
    @InjectModel(PlatformFeatureModulesModel.name)
    private readonly _model: Model<PlatformFeatureModulesDocument>,
  ) {}

  onModuleInit(): void {
    void this._warmCacheInBackground();
  }

  private _isCacheFresh(): boolean {
    return (
      this._cache != null && Date.now() - this._cacheAt < CACHE_TTL_MS
    );
  }

  private _storeCache(response: PlatformFeatureModulesResponse): void {
    this._cache = response;
    this._cacheAt = Date.now();
  }

  private _invalidateCache(): void {
    this._cache = null;
    this._cacheAt = 0;
  }

  private async _loadFromDb(): Promise<PlatformFeatureModulesResponse | null> {
    const doc = await this._model
      .findOne({ key: SETTINGS_KEY })
      .lean()
      .exec();
    if (!doc) return null;
    const response = toFeatureModulesResponse(
      doc as PlatformFeatureModulesModel & { updatedAt?: Date },
    );
    this._storeCache(response);
    return response;
  }

  /** Upsert singleton — uniquement au démarrage, à la mise à jour admin ou seed async. */
  private async _ensureDoc(): Promise<PlatformFeatureModulesModel> {
    const doc = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            admin: { ...DEFAULT_PLATFORM_SURFACE_MODULES },
            mobile: { ...DEFAULT_PLATFORM_SURFACE_MODULES },
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as PlatformFeatureModulesModel;
  }

  private async _warmCacheInBackground(): Promise<void> {
    try {
      const fromDb = await this._loadFromDb();
      if (fromDb) return;
      const doc = await this._ensureDoc();
      this._storeCache(toFeatureModulesResponse(doc));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._logger.warn(`Warm cache feature-modules: ${msg}`);
    }
  }

  private _scheduleSeedIfMissing(): void {
    if (this._seedInFlight) return;
    this._seedInFlight = (async () => {
      try {
        const doc = await this._ensureDoc();
        this._storeCache(toFeatureModulesResponse(doc));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this._logger.warn(`Seed feature-modules: ${msg}`);
      } finally {
        this._seedInFlight = null;
      }
    })();
  }

  async getPublicSettings(): Promise<PlatformFeatureModulesResponse> {
    if (this._isCacheFresh() && this._cache) {
      return this._cache;
    }

    if (this._cache) {
      void this._warmCacheInBackground();
      return this._cache;
    }

    const fromDb = await this._loadFromDb();
    if (fromDb) {
      return fromDb;
    }

    this._scheduleSeedIfMissing();
    const fallback = defaultFeatureModulesResponse();
    this._storeCache(fallback);
    return fallback;
  }

  async updateSettings(
    user: UserModel,
    dto: UpdatePlatformFeatureModulesDto,
  ): Promise<PlatformFeatureModulesResponse> {
    assertAdmin(user);
    this._invalidateCache();

    const current = await this._ensureDoc();
    const adminCurrent = normalizeSurfaceModules(current.admin);
    const mobileCurrent = normalizeSurfaceModules(current.mobile);

    const adminNext: PlatformSurfaceModules = mergeSurfaceModules(
      adminCurrent,
      dto.admin as Partial<PlatformSurfaceModules> | undefined,
    );
    const mobileNext: PlatformSurfaceModules = mergeSurfaceModules(
      mobileCurrent,
      dto.mobile as Partial<PlatformSurfaceModules> | undefined,
    );

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { admin: adminNext, mobile: mobileNext } },
        { new: true, lean: true },
      )
      .exec();
    const response = toFeatureModulesResponse(
      updated as PlatformFeatureModulesModel,
    );
    this._storeCache(response);
    return response;
  }
}
