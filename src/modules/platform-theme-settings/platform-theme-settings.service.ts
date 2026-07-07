import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { resolveEmailWebAssetUrl, resolveEmailWebSiteBase } from '@modules/mailer/email-web-asset-url.util';
import { MediasService } from '@modules/medias/medias.service';
import {
  PlatformThemeSettingsDocument,
  PlatformThemeSettingsModel,
} from '@schemas/platform-theme-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdatePlatformThemeSettingsDto } from './dto/update-platform-theme-settings.dto';
import { ThemeImageJsonDto } from './dto/theme-image.dto';

const SETTINGS_KEY = 'default';

export type PlatformThemeSettingsPayload = {
  mobileTabBackgroundLightUrl: string;
  mobileTabBackgroundDarkUrl: string;
  appLogoUrl: string;
  adminLogoUrl: string;
  /** Logo app effectif (DB ou repli env / site). */
  resolvedAppLogoUrl: string | null;
  /** Logo admin effectif (DB ou repli app logo / site). */
  resolvedAdminLogoUrl: string | null;
  updatedAt: string | null;
};

@Injectable()
export class PlatformThemeSettingsService {
  constructor(
    @InjectModel(PlatformThemeSettingsModel.name)
    private readonly _settings: Model<PlatformThemeSettingsDocument>,
    private readonly _medias: MediasService,
    private readonly _config: ConfigService,
  ) {}

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private normalizeUrl(raw: string | undefined | null): string {
    return String(raw ?? '').trim();
  }

  private envFallbackAppLogo(): string | null {
    const explicit = this._config.get<string>('EMAIL_LOGO_URL')?.trim();
    if (explicit) return explicit;
    const web =
      this._config.get<string>('EMAIL_WEBSITE_URL')?.trim() ||
      this._config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      this._config.get<string>('FRONTEND_URL')?.trim();
    if (web) return `${web.replace(/\/+$/, '')}/logo.png`;
    return null;
  }

  private resolvePayload(
    doc: PlatformThemeSettingsModel,
  ): PlatformThemeSettingsPayload {
    const typed = doc as unknown as { updatedAt?: Date };
    const appLogoUrl = this.normalizeUrl(doc.appLogoUrl);
    const adminLogoUrl = this.normalizeUrl(doc.adminLogoUrl);
    const envLogo = this.envFallbackAppLogo();
    const resolvedAppLogoUrl = appLogoUrl || envLogo;
    const resolvedAdminLogoUrl =
      adminLogoUrl || appLogoUrl || envLogo;
    return {
      mobileTabBackgroundLightUrl: this.normalizeUrl(
        doc.mobileTabBackgroundLightUrl,
      ),
      mobileTabBackgroundDarkUrl: this.normalizeUrl(
        doc.mobileTabBackgroundDarkUrl,
      ),
      appLogoUrl,
      adminLogoUrl,
      resolvedAppLogoUrl,
      resolvedAdminLogoUrl,
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  private async ensureDoc(): Promise<PlatformThemeSettingsModel> {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            mobileTabBackgroundLightUrl: '',
            mobileTabBackgroundDarkUrl: '',
            appLogoUrl: '',
            adminLogoUrl: '',
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as PlatformThemeSettingsModel;
  }

  async getPublicSettings(): Promise<PlatformThemeSettingsPayload> {
    const doc = await this.ensureDoc();
    return this.resolvePayload(doc);
  }

  /** Logo app pour e-mails (cache mémoire léger). */
  private cachedLogo: { at: number; url: string | null } | null = null;

  async getResolvedAppLogoUrl(): Promise<string | null> {
    const now = Date.now();
    if (this.cachedLogo && now - this.cachedLogo.at < 60_000) {
      return this.cachedLogo.url;
    }
    const settings = await this.getPublicSettings();
    const raw = settings.resolvedAppLogoUrl;
    const webBase = resolveEmailWebSiteBase(this._config);
    const web = raw ? resolveEmailWebAssetUrl(raw, webBase) : null;
    const resolved = web ?? `${webBase}/logo.png`;
    this.cachedLogo = { at: now, url: resolved };
    return resolved;
  }

  async updateSettings(
    user: UserModel,
    dto: UpdatePlatformThemeSettingsDto,
  ): Promise<PlatformThemeSettingsPayload> {
    this.assertAdmin(user);
    const patch: Record<string, string> = {};
    if (dto.mobileTabBackgroundLightUrl !== undefined) {
      patch.mobileTabBackgroundLightUrl = this.normalizeUrl(
        dto.mobileTabBackgroundLightUrl,
      );
    }
    if (dto.mobileTabBackgroundDarkUrl !== undefined) {
      patch.mobileTabBackgroundDarkUrl = this.normalizeUrl(
        dto.mobileTabBackgroundDarkUrl,
      );
    }
    if (dto.appLogoUrl !== undefined) {
      patch.appLogoUrl = this.normalizeUrl(dto.appLogoUrl);
    }
    if (dto.adminLogoUrl !== undefined) {
      patch.adminLogoUrl = this.normalizeUrl(dto.adminLogoUrl);
    }
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: patch },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.cachedLogo = null;
    return this.resolvePayload(updated);
  }

  async uploadThemeImageJson(
    user: UserModel,
    dto: ThemeImageJsonDto,
  ): Promise<{ url: string; purpose: ThemeImageJsonDto['purpose'] }> {
    this.assertAdmin(user);
    const raw = dto.imageBase64
      .replace(/\s/g, '')
      .replace(/^data:image\/[^;]+;base64,/i, '');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('invalid_base64');
    }
    if (!buffer.length) {
      throw new BadRequestException('empty_image');
    }
    const max = await this._medias.getMaxFileSizeBytes();
    if (buffer.length > max) {
      throw new BadRequestException('file_too_large');
    }
    const name = (dto.filename || 'theme-asset.png').trim() || 'theme-asset.png';
    if (!/\.(jpe?g|png|webp|svg)$/i.test(name)) {
      throw new BadRequestException('invalid_file_type');
    }
    const lower = name.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.svg')
          ? 'image/svg+xml'
          : 'image/jpeg';
    const file = {
      fieldname: 'image',
      originalname: name,
      encoding: '7bit',
      mimetype: mime,
      buffer,
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: undefined,
    } as Express.Multer.File;
    const url = await this._medias.upload(file, user, 'platform-theme');
    const resolved =
      (await this._medias.resolvePublicMediaUrl(url)) ?? url;
    return { url: resolved, purpose: dto.purpose };
  }
}
