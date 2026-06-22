import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformFeatureModulesDocument,
  PlatformFeatureModulesModel,
} from '@schemas/platform-feature-modules.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdatePlatformFeatureModulesDto } from './dto/update-platform-feature-modules.dto';
import {
  DEFAULT_PLATFORM_SURFACE_MODULES,
  type PlatformSurfaceModules,
} from './platform-feature-modules.constants';
import {
  mergeSurfaceModules,
  normalizeSurfaceModules,
  PlatformFeatureModulesResponse,
  toFeatureModulesResponse,
} from './platform-feature-modules.util';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class PlatformFeatureModulesService {
  constructor(
    @InjectModel(PlatformFeatureModulesModel.name)
    private readonly _model: Model<PlatformFeatureModulesDocument>,
  ) {}

  private async _ensureDoc(): Promise<PlatformFeatureModulesModel> {
    const doc = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            admin: { ...DEFAULT_PLATFORM_SURFACE_MODULES },
            mobile: { ...DEFAULT_PLATFORM_SURFACE_MODULES },
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as PlatformFeatureModulesModel;
  }

  async getPublicSettings(): Promise<PlatformFeatureModulesResponse> {
    const doc = await this._ensureDoc();
    return toFeatureModulesResponse(doc);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdatePlatformFeatureModulesDto,
  ): Promise<PlatformFeatureModulesResponse> {
    assertAdmin(user);
    const current = await this._ensureDoc();
    const adminCurrent = normalizeSurfaceModules(current.admin);
    const mobileCurrent = normalizeSurfaceModules(current.mobile);

    const adminNext: PlatformSurfaceModules = mergeSurfaceModules(
      adminCurrent,
      dto.admin as Partial<PlatformSurfaceModules> | undefined,
    );
    const mobileNext: PlatformSurfaceModules = mergeSurfaceModules(
      mobileCurrent,
      dto.mobile as Partial<PlatformSurfaceModules> | undefined,
    );

    const updated = await this._model
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        { $set: { admin: adminNext, mobile: mobileNext } },
        { new: true, lean: true },
      )
      .exec();
    return toFeatureModulesResponse(updated as PlatformFeatureModulesModel);
  }
}
