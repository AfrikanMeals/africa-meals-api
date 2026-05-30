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

  private _normalizeUrl(raw: string | undefined | null): string {
    const value = String(raw ?? '').trim();
    return value;
  }

  private _toResponse(doc: MobileAppSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      appStoreUrl: this._normalizeUrl(doc.appStoreUrl),
      playStoreUrl: this._normalizeUrl(doc.playStoreUrl),
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
            appStoreUrl: this._normalizeUrl(dto.appStoreUrl),
            playStoreUrl: this._normalizeUrl(dto.playStoreUrl),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
