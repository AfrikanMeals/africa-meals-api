import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  StorageSettingsDocument,
  StorageSettingsModel,
  StorageEngineMode,
} from '@schemas/storage-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';

const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 5_000;

export type StorageSettingsResponse = {
  compressionEnabled: boolean;
  maxFileSizeMb: number;
  storageEngine: StorageEngineMode;
  mediaProxyEnabled: boolean;
  updatedAt: string | null;
};

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
      mediaProxyEnabled: doc.mediaProxyEnabled === true,
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
            mediaProxyEnabled: false,
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

  async updateSettings(user: UserModel, dto: UpdateStorageSettingsDto) {
    assertAdmin(user);
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            compressionEnabled: dto.compressionEnabled,
            maxFileSizeMb: dto.maxFileSizeMb,
            storageEngine: dto.storageEngine,
            mediaProxyEnabled: dto.mediaProxyEnabled,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.invalidateCache();
    return this._toResponse(updated);
  }
}
