import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  MapSettingsDocument,
  MapSettingsModel,
} from '@schemas/map-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateMapSettingsDto } from './dto/update-map-settings.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

function assertAtLeastOneEngine(mapbox: boolean, google: boolean, scope: string) {
  if (!mapbox && !google) {
    throw new BadRequestException(`at_least_one_map_engine_required_${scope}`);
  }
}

@Injectable()
export class MapSettingsService {
  constructor(
    @InjectModel(MapSettingsModel.name)
    private readonly _settings: Model<MapSettingsDocument>,
  ) {}

  private _toResponse(doc: MapSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      vendor: {
        mapboxEnabled: doc.vendorMapboxEnabled !== false,
        googleEnabled: doc.vendorGoogleEnabled !== false,
      },
      mobileUser: {
        mapboxEnabled: doc.mobileUserMapboxEnabled !== false,
        googleEnabled: doc.mobileUserGoogleEnabled !== false,
      },
      mobileDelivery: {
        mapboxEnabled: doc.mobileDeliveryMapboxEnabled !== false,
        googleEnabled: doc.mobileDeliveryGoogleEnabled !== false,
      },
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
            vendorMapboxEnabled: true,
            vendorGoogleEnabled: true,
            mobileUserMapboxEnabled: true,
            mobileUserGoogleEnabled: true,
            mobileDeliveryMapboxEnabled: true,
            mobileDeliveryGoogleEnabled: true,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(doc as MapSettingsModel);
  }

  async updateSettings(user: UserModel, dto: UpdateMapSettingsDto) {
    assertAdmin(user);
    assertAtLeastOneEngine(
      dto.vendorMapboxEnabled,
      dto.vendorGoogleEnabled,
      'vendor',
    );
    assertAtLeastOneEngine(
      dto.mobileUserMapboxEnabled,
      dto.mobileUserGoogleEnabled,
      'mobile_user',
    );
    assertAtLeastOneEngine(
      dto.mobileDeliveryMapboxEnabled,
      dto.mobileDeliveryGoogleEnabled,
      'mobile_delivery',
    );

    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            vendorMapboxEnabled: dto.vendorMapboxEnabled,
            vendorGoogleEnabled: dto.vendorGoogleEnabled,
            mobileUserMapboxEnabled: dto.mobileUserMapboxEnabled,
            mobileUserGoogleEnabled: dto.mobileUserGoogleEnabled,
            mobileDeliveryMapboxEnabled: dto.mobileDeliveryMapboxEnabled,
            mobileDeliveryGoogleEnabled: dto.mobileDeliveryGoogleEnabled,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this._toResponse(updated);
  }
}
