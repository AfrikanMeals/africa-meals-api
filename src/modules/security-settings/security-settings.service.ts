import {
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  SecuritySettingsDocument,
  SecuritySettingsModel,
} from '@schemas/security-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateSecuritySettingsDto } from './dto/update-security-settings.dto';
import {
  AppCheckPlatform,
  AppCheckPlatformFlags,
} from './app-check-platform.util';

const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 5_000;

const DEFAULT_FLAGS: AppCheckPlatformFlags = {
  mobile: false,
  web: false,
  admin: false,
  websocket: false,
  api: false,
};

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function resolvePlatformFlags(doc: SecuritySettingsModel): AppCheckPlatformFlags {
  const hasGranular =
    doc.appCheckMobileEnabled !== undefined ||
    doc.appCheckWebEnabled !== undefined ||
    doc.appCheckAdminEnabled !== undefined ||
    doc.appCheckWebsocketEnabled !== undefined ||
    doc.appCheckApiEnabled !== undefined;

  if (hasGranular) {
    return {
      mobile: doc.appCheckMobileEnabled === true,
      web: doc.appCheckWebEnabled === true,
      admin: doc.appCheckAdminEnabled === true,
      websocket: doc.appCheckWebsocketEnabled === true,
      api: doc.appCheckApiEnabled === true,
    };
  }

  if (doc.appCheckEnabled === true) {
    return {
      mobile: true,
      web: true,
      admin: true,
      websocket: true,
      api: true,
    };
  }

  return { ...DEFAULT_FLAGS };
}

@Injectable()
export class SecuritySettingsService implements OnModuleInit {
  private cacheFlags: AppCheckPlatformFlags | null = null;
  private cacheExpiresAt = 0;

  constructor(
    @InjectModel(SecuritySettingsModel.name)
    private readonly _settings: Model<SecuritySettingsDocument>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.normalizeLegacyDocument();
  }

  private _toResponse(doc: SecuritySettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    const siteKey =
      this.config.get<string>('RECAPTCHA_ENTERPRISE_SITE_KEY')?.trim() ?? '';
    const platforms = resolvePlatformFlags(doc);
    return {
      ...platforms,
      recaptchaSiteKey: siteKey.length > 0 ? siteKey : null,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  private invalidateCache() {
    this.cacheFlags = null;
    this.cacheExpiresAt = 0;
  }

  private async getPlatformFlags(): Promise<AppCheckPlatformFlags> {
    const now = Date.now();
    if (this.cacheFlags && now < this.cacheExpiresAt) {
      return this.cacheFlags;
    }
    const doc = await this._settings
      .findOne({ key: SETTINGS_KEY })
      .lean()
      .exec();
    const flags = doc
      ? resolvePlatformFlags(doc as SecuritySettingsModel)
      : { ...DEFAULT_FLAGS };
    this.cacheFlags = flags;
    this.cacheExpiresAt = now + CACHE_TTL_MS;
    return flags;
  }

  async isAppCheckRequiredForPlatform(
    platform: AppCheckPlatform,
  ): Promise<boolean> {
    const flags = await this.getPlatformFlags();
    if (!flags.api) return false;
    if (platform === 'unknown') return false;
    return flags[platform] === true;
  }

  /** @deprecated Préférer isAppCheckRequiredForPlatform */
  async isAppCheckEnabled(): Promise<boolean> {
    const flags = await this.getPlatformFlags();
    return (
      flags.api &&
      Object.entries(flags).some(
        ([key, value]) => key !== 'api' && value === true,
      )
    );
  }

  async getPublicSettings() {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            appCheckEnabled: false,
            appCheckMobileEnabled: false,
            appCheckWebEnabled: false,
            appCheckAdminEnabled: false,
            appCheckWebsocketEnabled: false,
            appCheckApiEnabled: false,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as SecuritySettingsModel);
  }

  async updateSettings(user: UserModel, dto: UpdateSecuritySettingsDto) {
    assertAdmin(user);
    const anyEnabled =
      dto.appCheckApiEnabled &&
      (dto.appCheckMobileEnabled ||
        dto.appCheckWebEnabled ||
        dto.appCheckAdminEnabled ||
        dto.appCheckWebsocketEnabled);
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            appCheckMobileEnabled: dto.appCheckMobileEnabled,
            appCheckWebEnabled: dto.appCheckWebEnabled,
            appCheckAdminEnabled: dto.appCheckAdminEnabled,
            appCheckWebsocketEnabled: dto.appCheckWebsocketEnabled,
            appCheckApiEnabled: dto.appCheckApiEnabled,
            appCheckEnabled: anyEnabled,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.invalidateCache();
    return this._toResponse(updated);
  }

  /** Normalise les documents legacy (appCheckEnabled seul) en flags granulaires explicites. */
  async normalizeLegacyDocument(): Promise<void> {
    const doc = await this._settings.findOne({ key: SETTINGS_KEY }).exec();
    if (!doc) return;
    const hasGranular =
      doc.appCheckMobileEnabled !== undefined ||
      doc.appCheckWebEnabled !== undefined ||
      doc.appCheckAdminEnabled !== undefined ||
      doc.appCheckWebsocketEnabled !== undefined ||
      doc.appCheckApiEnabled !== undefined;
    if (hasGranular) return;
    const legacy = doc.appCheckEnabled === true;
    await this._settings
      .updateOne(
        { key: SETTINGS_KEY },
        {
          $set: {
            appCheckMobileEnabled: legacy,
            appCheckWebEnabled: legacy,
            appCheckAdminEnabled: legacy,
            appCheckWebsocketEnabled: legacy,
            appCheckApiEnabled: legacy,
          },
        },
      )
      .exec();
    this.invalidateCache();
  }
}
