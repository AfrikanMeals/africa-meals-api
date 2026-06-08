import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MobileAppSettingsDocument,
  MobileAppSettingsModel,
} from '@schemas/mobile-app-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
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
      contactEmail: this._normalizeText(doc.contactEmail),
      contactPhone: this._normalizeText(doc.contactPhone),
      mainEmail: this._normalizeText(doc.mainEmail),
      whatsappNumber: this._normalizeText(doc.whatsappNumber),
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
            contactEmail: '',
            contactPhone: '',
            mainEmail: '',
            whatsappNumber: '',
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as MobileAppSettingsModel);
  }

  async updateSettings(user: UserModel, dto: UpdateMobileAppSettingsDto) {
    assertAdmin(user);
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
            contactEmail: this._normalizeText(dto.contactEmail),
            contactPhone: this._normalizeText(dto.contactPhone),
            mainEmail: this._normalizeText(dto.mainEmail),
            whatsappNumber: this._normalizeText(dto.whatsappNumber),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
