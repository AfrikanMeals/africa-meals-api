import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  StockManagerSettingsDocument,
  StockManagerSettingsModel,
} from '@schemas/stock-manager-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { UpdateStockManagerSettingsDto } from './dto/update-stock-manager-settings.dto';

const SETTINGS_KEY = 'default';

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

@Injectable()
export class StockManagerSettingsService {
  constructor(
    @InjectModel(StockManagerSettingsModel.name)
    private readonly _settings: Model<StockManagerSettingsDocument>,
  ) {}

  private async ensureDoc(): Promise<StockManagerSettingsModel> {
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            ingredientStockManagementEnabled: false,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc as StockManagerSettingsModel;
  }

  private toResponse(doc: StockManagerSettingsModel) {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      ingredientStockManagementEnabled: Boolean(
        doc.ingredientStockManagementEnabled,
      ),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  async getPublicSettings() {
    const doc = await this.ensureDoc();
    return this.toResponse(doc);
  }

  async isIngredientStockManagementEnabled(): Promise<boolean> {
    const doc = await this.ensureDoc();
    return Boolean(doc.ingredientStockManagementEnabled);
  }

  async assertIngredientStockManagementEnabled(): Promise<void> {
    const enabled = await this.isIngredientStockManagementEnabled();
    if (!enabled) {
      throw new ForbiddenException('ingredient_stock_management_disabled');
    }
  }

  async updateSettings(user: UserModel, dto: UpdateStockManagerSettingsDto) {
    assertAdmin(user);
    const patch: Record<string, unknown> = {};
    if (dto.ingredientStockManagementEnabled !== undefined) {
      patch.ingredientStockManagementEnabled =
        dto.ingredientStockManagementEnabled;
    }
    const doc = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: patch,
          $setOnInsert: {
            key: SETTINGS_KEY,
            ingredientStockManagementEnabled: false,
          },
        },
        { upsert: true, new: true, lean: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toResponse(doc as StockManagerSettingsModel);
  }
}
