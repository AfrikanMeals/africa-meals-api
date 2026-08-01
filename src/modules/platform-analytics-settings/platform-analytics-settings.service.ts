import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  PlatformAnalyticsSettingsDocument,
  PlatformAnalyticsSettingsModel,
} from '@schemas/platform-analytics-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdatePlatformAnalyticsSettingsDto } from './dto/update-platform-analytics-settings.dto';
import {
  DEFAULT_PLATFORM_ANALYTICS_ADMIN,
  DEFAULT_PLATFORM_ANALYTICS_MOBILE,
  DEFAULT_PLATFORM_ANALYTICS_WEB,
} from './platform-analytics-settings.constants';
import {
  defaultAnalyticsSettingsResponse,
  mergeAdminFlags,
  mergeMobileFlags,
  mergeWebFlags,
  normalizeAdminFlags,
  normalizeMobileFlags,
  normalizeWebFlags,
  PlatformAnalyticsSettingsResponse,
  toAnalyticsSettingsResponse,
} from './platform-analytics-settings.util';

const SETTINGS_KEY = 'default';

const CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.PLATFORM_ANALYTICS_SETTINGS_CACHE_TTL_MS) || 300_000,
);

@Injectable()
export class PlatformAnalyticsSettingsService implements OnModuleInit {
  private readonly _logger = new Logger(PlatformAnalyticsSettingsService.name);
  private _cache: PlatformAnalyticsSettingsResponse | null = null;
  private _cacheAt = 0;
  private _seedInFlight: Promise<void> | null = null;

  constructor(
    @InjectModel(PlatformAnalyticsSettingsModel.name)
    private readonly _model: Model<PlatformAnalyticsSettingsDocument>,
    private readonly _storeAccess: StoreAccessService,
  ) {}

  onModuleInit(): void {
    void this._warmCacheInBackground();
  }

  private async _assertAdminSettings(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this._storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private _isCacheFresh(): boolean {
    return this._cache != null && Date.now() - this._cacheAt < CACHE_TTL_MS;
  }

  private _storeCache(response: PlatformAnalyticsSettingsResponse): void {
    this._cache = response;
    this._cacheAt = Date.now();
  }

  private _invalidateCache(): void {
    this._cache = null;
    this._cacheAt = 0;
  }

  private async _loadFromDb(): Promise<PlatformAnalyticsSettingsResponse | null> {
    try {
      const doc = await this._model
        .findOne({ key: SETTINGS_KEY })
        .lean()
        .exec();
      if (!doc) return null;
      const response = toAnalyticsSettingsResponse(
        doc as PlatformAnalyticsSettingsModel & { updatedAt?: Date },
      );
      this._storeCache(response);
      return response;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._logger.warn(`Load analytics-settings: ${msg}`);
      return null;
    }
  }

  private async _ensureDoc(): Promise<PlatformAnalyticsSettingsModel> {
    const doc = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            admin: { ...DEFAULT_PLATFORM_ANALYTICS_ADMIN },
            web: { ...DEFAULT_PLATFORM_ANALYTICS_WEB },
            mobile: { ...DEFAULT_PLATFORM_ANALYTICS_MOBILE },
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as PlatformAnalyticsSettingsModel;
  }

  private async _warmCacheInBackground(): Promise<void> {
    try {
      const fromDb = await this._loadFromDb();
      if (fromDb) return;
      const doc = await this._ensureDoc();
      this._storeCache(toAnalyticsSettingsResponse(doc));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._logger.warn(`Warm cache analytics-settings: ${msg}`);
    }
  }

  private _scheduleSeedIfMissing(): void {
    if (this._seedInFlight) return;
    this._seedInFlight = (async () => {
      try {
        const doc = await this._ensureDoc();
        this._storeCache(toAnalyticsSettingsResponse(doc));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this._logger.warn(`Seed analytics-settings: ${msg}`);
      } finally {
        this._seedInFlight = null;
      }
    })();
  }

  /** Lecture publique (web / mobile / admin boot) — fail-open tout ON. */
  async getPublicSettings(): Promise<PlatformAnalyticsSettingsResponse> {
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
    const fallback = defaultAnalyticsSettingsResponse();
    this._storeCache(fallback);
    return fallback;
  }

  async updateSettings(
    user: UserModel,
    dto: UpdatePlatformAnalyticsSettingsDto,
  ): Promise<PlatformAnalyticsSettingsResponse> {
    await this._assertAdminSettings(user);
    this._invalidateCache();

    const current = await this._ensureDoc();
    const adminNext = mergeAdminFlags(
      normalizeAdminFlags(current.admin),
      dto.admin,
    );
    const webNext = mergeWebFlags(normalizeWebFlags(current.web), dto.web);
    const mobileNext = mergeMobileFlags(
      normalizeMobileFlags(current.mobile),
      dto.mobile,
    );

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { admin: adminNext, web: webNext, mobile: mobileNext } },
        { new: true, lean: true },
      )
      .exec();
    const response = toAnalyticsSettingsResponse(
      updated as PlatformAnalyticsSettingsModel,
    );
    this._storeCache(response);
    return response;
  }
}
