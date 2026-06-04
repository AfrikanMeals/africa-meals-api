import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuthSettingsDocument,
  AuthSettingsModel,
  OAuthProviderKey,
} from '@schemas/auth-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateAuthSettingsDto } from './dto/update-auth-settings.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class AuthSettingsService {
  constructor(
    @InjectModel(AuthSettingsModel.name)
    private readonly _settings: Model<AuthSettingsDocument>,
  ) {}

  private _toResponse(doc: AuthSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      googleEnabled: doc.googleEnabled !== false,
      appleEnabled: doc.appleEnabled !== false,
      facebookEnabled: doc.facebookEnabled !== false,
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
            googleEnabled: true,
            appleEnabled: true,
            facebookEnabled: true,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as AuthSettingsModel);
  }

  async assertProviderEnabled(provider: OAuthProviderKey): Promise<void> {
    const settings = await this.getPublicSettings();
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
            googleEnabled: dto.googleEnabled,
            appleEnabled: dto.appleEnabled,
            facebookEnabled: dto.facebookEnabled,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
