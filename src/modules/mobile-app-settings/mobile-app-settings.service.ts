import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MobileAppSettingsDocument,
  MobileAppSettingsModel,
} from '@schemas/mobile-app-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import {
  emptyAppVersioning,
  normalizeAppVersioning,
} from './app-versioning.util';
import { UpdateMobileAppSettingsDto } from './dto/update-mobile-app-settings.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class MobileAppSettingsService {
  constructor(
    @InjectModel(MobileAppSettingsModel.name)
    private readonly _settings: Model<MobileAppSettingsDocument>,
  ) {}

  private _normalizeText(raw: string | undefined | null): string {
    return String(raw ?? '').trim();
  }

  private _toResponse(doc: MobileAppSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      appStoreUrl: this._normalizeText(doc.appStoreUrl),
      playStoreUrl: this._normalizeText(doc.playStoreUrl),
      facebookUrl: this._normalizeText(doc.facebookUrl),
      instagramUrl: this._normalizeText(doc.instagramUrl),
      tiktokUrl: this._normalizeText(doc.tiktokUrl),
      xUrl: this._normalizeText(doc.xUrl),
      youtubeUrl: this._normalizeText(doc.youtubeUrl),
      snapchatUrl: this._normalizeText(doc.snapchatUrl),
      linkedinUrl: this._normalizeText(doc.linkedinUrl),
      pinterestUrl: this._normalizeText(doc.pinterestUrl),
      contactEmail: this._normalizeText(doc.contactEmail),
      contactPhone: this._normalizeText(doc.contactPhone),
      mainEmail: this._normalizeText(doc.mainEmail),
      whatsappNumber: this._normalizeText(doc.whatsappNumber),
      // Bloc versioning normalisé (jamais undefined côté clients).
      appVersioning: normalizeAppVersioning(doc.appVersioning),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getPublicSettings() {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            appStoreUrl: '',
            playStoreUrl: '',
            facebookUrl: '',
            instagramUrl: '',
            tiktokUrl: '',
            xUrl: '',
            youtubeUrl: '',
            snapchatUrl: '',
            linkedinUrl: '',
            pinterestUrl: '',
            contactEmail: '',
            contactPhone: '',
            mainEmail: '',
            whatsappNumber: '',
            appVersioning: emptyAppVersioning(),
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as MobileAppSettingsModel);
  }

  async updateSettings(user: UserModel, dto: UpdateMobileAppSettingsDto) {
    assertAdmin(user);
    // Merge versioning : si absent du DTO, conserver l’existant en base.
    const existing = await this._settings
      .findOne({ key: SETTINGS_KEY })
      .lean()
      .exec();
    const nextVersioning =
      dto.appVersioning !== undefined
        ? normalizeAppVersioning(dto.appVersioning)
        : normalizeAppVersioning(
            (existing as { appVersioning?: unknown } | null)?.appVersioning,
          );

    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            appStoreUrl: this._normalizeText(dto.appStoreUrl),
            playStoreUrl: this._normalizeText(dto.playStoreUrl),
            facebookUrl: this._normalizeText(dto.facebookUrl),
            instagramUrl: this._normalizeText(dto.instagramUrl),
            tiktokUrl: this._normalizeText(dto.tiktokUrl),
            xUrl: this._normalizeText(dto.xUrl),
            youtubeUrl: this._normalizeText(dto.youtubeUrl),
            snapchatUrl: this._normalizeText(dto.snapchatUrl),
            linkedinUrl: this._normalizeText(dto.linkedinUrl),
            pinterestUrl: this._normalizeText(dto.pinterestUrl),
            contactEmail: this._normalizeText(dto.contactEmail),
            contactPhone: this._normalizeText(dto.contactPhone),
            mainEmail: this._normalizeText(dto.mainEmail),
            whatsappNumber: this._normalizeText(dto.whatsappNumber),
            appVersioning: nextVersioning,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
