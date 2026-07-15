import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuthOAuthPlatform,
  AuthOAuthPlatformFlags,
  AuthSettingsDocument,
  AuthSettingsModel,
  OAuthProviderKey,
} from '@schemas/auth-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateAuthSettingsDto } from './dto/update-auth-settings.dto';

const SETTINGS_KEY = 'default';

/** TTL cache mémoire — évite un upsert Mongo à chaque login OAuth. */
const PUBLIC_SETTINGS_CACHE_TTL_MS = 30_000;

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

export type AuthSettingsScope = AuthOAuthPlatform | 'full';

@Injectable()
export class AuthSettingsService {
  private _publicCache:
    | { at: number; doc: AuthSettingsModel }
    | null = null;

  constructor(
    @InjectModel(AuthSettingsModel.name)
    private readonly _settings: Model<AuthSettingsDocument>,
  ) {}

  private _resolveOAuthFlags(doc: AuthSettingsModel): {
    admin: AuthOAuthPlatformFlags;
    mobile: AuthOAuthPlatformFlags;
  } {
    const legacyGoogle = doc.googleEnabled !== false;
    const legacyApple = doc.appleEnabled !== false;
    const legacyFacebook = doc.facebookEnabled !== false;

    return {
      admin: {
        googleEnabled: doc.googleEnabledAdmin ?? legacyGoogle,
        appleEnabled: doc.appleEnabledAdmin ?? legacyApple,
        facebookEnabled: doc.facebookEnabledAdmin ?? legacyFacebook,
      },
      mobile: {
        googleEnabled: doc.googleEnabledMobile ?? legacyGoogle,
        appleEnabled: doc.appleEnabledMobile ?? legacyApple,
        facebookEnabled: doc.facebookEnabledMobile ?? legacyFacebook,
      },
    };
  }

  private _toFullResponse(doc: AuthSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    const oauth = this._resolveOAuthFlags(doc);
    return {
      oauth,
      loginEmailNotifyAdminEnabled: doc.loginEmailNotifyAdminEnabled !== false,
      loginEmailNotifyMobileEnabled: doc.loginEmailNotifyMobileEnabled !== false,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
      googleEnabled: oauth.mobile.googleEnabled,
      appleEnabled: oauth.mobile.appleEnabled,
      facebookEnabled: oauth.mobile.facebookEnabled,
    };
  }

  private _toPlatformResponse(
    doc: AuthSettingsModel,
    platform: AuthOAuthPlatform,
  ) {
    const full = this._toFullResponse(doc);
    const flags = full.oauth[platform];
    return {
      ...flags,
      loginEmailNotifyAdminEnabled: full.loginEmailNotifyAdminEnabled,
      loginEmailNotifyMobileEnabled: full.loginEmailNotifyMobileEnabled,
      updatedAt: full.updatedAt,
    };
  }

  private _fromCacheOrNull(): AuthSettingsModel | null {
    if (!this._publicCache) return null;
    if (Date.now() - this._publicCache.at >= PUBLIC_SETTINGS_CACHE_TTL_MS) {
      this._publicCache = null;
      return null;
    }
    return this._publicCache.doc;
  }

  private _storeCache(doc: AuthSettingsModel) {
    this._publicCache = { at: Date.now(), doc };
  }

  /** Invalide le cache (tests / update admin). */
  clearPublicSettingsCache() {
    this._publicCache = null;
  }

  /**
   * Settings OAuth publics.
   * Lecture `findOne` + cache TTL ; upsert uniquement si doc absent (1er boot).
   */
  async getPublicSettings(scope: AuthSettingsScope = 'full') {
    let model = this._fromCacheOrNull();
    if (!model) {
      let doc = await this._settings
        .findOne({ key: SETTINGS_KEY })
        .lean()
        .exec();
      if (!doc) {
        // 1er déploiement uniquement — ne pas upsert à chaque login.
        doc = await this._settings
          .findOneAndUpdate(
            { key: SETTINGS_KEY },
            {
              $setOnInsert: {
                key: SETTINGS_KEY,
                googleEnabled: true,
                appleEnabled: true,
                facebookEnabled: true,
                googleEnabledAdmin: true,
                googleEnabledMobile: true,
                appleEnabledAdmin: true,
                appleEnabledMobile: true,
                facebookEnabledAdmin: true,
                facebookEnabledMobile: true,
                loginEmailNotifyAdminEnabled: true,
                loginEmailNotifyMobileEnabled: true,
              },
            },
            {
              upsert: true,
              new: true,
              lean: true,
              setDefaultsOnInsert: true,
            },
          )
          .exec();
      }
      model = doc as AuthSettingsModel;
      this._storeCache(model);
    }

    if (scope === 'full') {
      return this._toFullResponse(model);
    }
    return this._toPlatformResponse(model, scope);
  }

  async assertProviderEnabled(
    provider: OAuthProviderKey,
    platform: AuthOAuthPlatform,
  ): Promise<void> {
    const settings = await this.getPublicSettings(platform);
    const map: Record<OAuthProviderKey, boolean> = {
      google: settings.googleEnabled,
      apple: settings.appleEnabled,
      facebook: settings.facebookEnabled,
    };
    if (!map[provider]) {
      throw new BadRequestException(`oauth_${provider}_disabled`);
    }
  }

  async updateSettings(user: UserModel, dto: UpdateAuthSettingsDto) {
    assertAdmin(user);
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            googleEnabledAdmin: dto.googleEnabledAdmin,
            googleEnabledMobile: dto.googleEnabledMobile,
            appleEnabledAdmin: dto.appleEnabledAdmin,
            appleEnabledMobile: dto.appleEnabledMobile,
            facebookEnabledAdmin: dto.facebookEnabledAdmin,
            facebookEnabledMobile: dto.facebookEnabledMobile,
            googleEnabled: dto.googleEnabledMobile,
            appleEnabled: dto.appleEnabledMobile,
            facebookEnabled: dto.facebookEnabledMobile,
            loginEmailNotifyAdminEnabled: dto.loginEmailNotifyAdminEnabled,
            loginEmailNotifyMobileEnabled: dto.loginEmailNotifyMobileEnabled,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    // Document Mongoose → forme lean pour le cache.
    const lean = (
      typeof (updated as { toObject?: () => AuthSettingsModel }).toObject ===
      'function'
        ? (updated as { toObject: () => AuthSettingsModel }).toObject()
        : updated
    ) as AuthSettingsModel;
    this._storeCache(lean);
    return this._toFullResponse(lean);
  }
}
