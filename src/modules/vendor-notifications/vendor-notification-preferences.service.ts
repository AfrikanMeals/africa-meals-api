import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { VendorNotificationPreferencesModel } from '@schemas/vendor-notification-preferences.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  defaultVendorNotificationPreferences,
  VENDOR_NOTIFICATION_CATEGORIES,
  type VendorNotificationCategory,
  type VendorNotificationPreferencesMap,
} from './vendor-notification.constants';
import {
  normalizeChannelPrefs,
  type UpdateVendorNotificationPreferencesDto,
} from './dto/vendor-notification.dto';

@Injectable()
export class VendorNotificationPreferencesService {
  constructor(
    @InjectModel(VendorNotificationPreferencesModel.name)
    private readonly prefsModel: Model<VendorNotificationPreferencesModel>,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async getForStore(storeId: string): Promise<VendorNotificationPreferencesMap> {
    const sid = storeId.trim();
    if (!Types.ObjectId.isValid(sid)) {
      throw new BadRequestException('invalid_store_id');
    }
    const doc = await this.prefsModel
      .findOne({ store: new Types.ObjectId(sid) })
      .lean()
      .exec();
    return this.mergeWithDefaults(
      (doc?.categories ?? null) as VendorNotificationPreferencesMap | null,
    );
  }

  async getBillingState(storeId: string): Promise<{
    smsBillingSuspended: boolean;
    smsBillingSuspendedAt?: Date | null;
    smsBillingSuspendReason?: string | null;
  }> {
    const sid = storeId.trim();
    if (!Types.ObjectId.isValid(sid)) {
      throw new BadRequestException('invalid_store_id');
    }
    const doc = await this.prefsModel
      .findOne({ store: new Types.ObjectId(sid) })
      .select('smsBillingSuspended smsBillingSuspendedAt smsBillingSuspendReason')
      .lean()
      .exec();
    return {
      smsBillingSuspended: doc?.smsBillingSuspended === true,
      smsBillingSuspendedAt: doc?.smsBillingSuspendedAt ?? null,
      smsBillingSuspendReason: doc?.smsBillingSuspendReason ?? null,
    };
  }

  async getForStoreAsVendor(
    user: UserModel,
    storeId: string,
  ): Promise<{
    storeId: string;
    categories: VendorNotificationPreferencesMap;
    smsBillingSuspended: boolean;
    smsBillingSuspendedAt?: Date | null;
    smsBillingSuspendReason?: string | null;
  }> {
    await this.assertCanManageStore(user, storeId);
    const categories = await this.getForStore(storeId);
    const billing = await this.getBillingState(storeId);
    return {
      storeId: storeId.trim(),
      categories,
      ...billing,
    };
  }

  async updateForStoreAsVendor(
    user: UserModel,
    storeId: string,
    dto: UpdateVendorNotificationPreferencesDto,
  ): Promise<{ storeId: string; categories: VendorNotificationPreferencesMap }> {
    await this.assertCanManageStore(user, storeId);
    const sid = storeId.trim();
    const current = await this.getForStore(sid);
    const next = { ...current };
    const patch = dto.categories ?? {};
    for (const key of Object.keys(patch) as VendorNotificationCategory[]) {
      if (!VENDOR_NOTIFICATION_CATEGORIES.includes(key)) continue;
      next[key] = normalizeChannelPrefs(patch[key], current[key]);
    }
    await this.prefsModel
      .findOneAndUpdate(
        { store: new Types.ObjectId(sid) },
        { $set: { categories: next } },
        { upsert: true, new: true },
      )
      .exec();
    return { storeId: sid, categories: next };
  }

  async isChannelEnabled(
    storeId: string,
    category: VendorNotificationCategory,
    channel: 'push' | 'email' | 'sms',
  ): Promise<boolean> {
    if (channel === 'sms') {
      return this.isSmsChannelAllowed(storeId, category);
    }
    const prefs = await this.getForStore(storeId);
    return prefs[category]?.[channel] === true;
  }

  async isSmsChannelAllowed(
    storeId: string,
    category: VendorNotificationCategory,
  ): Promise<boolean> {
    const sid = storeId.trim();
    if (!Types.ObjectId.isValid(sid)) return false;
    const doc = await this.prefsModel
      .findOne({ store: new Types.ObjectId(sid) })
      .select('categories smsBillingSuspended')
      .lean()
      .exec();
    if (doc?.smsBillingSuspended === true) return false;
    const categories = this.mergeWithDefaults(
      (doc?.categories ?? null) as VendorNotificationPreferencesMap | null,
    );
    return categories[category]?.sms === true;
  }

  async suspendSmsBilling(storeId: string, reason: string): Promise<void> {
    const sid = storeId.trim();
    if (!Types.ObjectId.isValid(sid)) return;
    await this.prefsModel
      .findOneAndUpdate(
        { store: new Types.ObjectId(sid) },
        {
          $set: {
            smsBillingSuspended: true,
            smsBillingSuspendedAt: new Date(),
            smsBillingSuspendReason: reason.slice(0, 500),
          },
        },
        { upsert: true },
      )
      .exec();
  }

  async resumeSmsBilling(storeId: string): Promise<void> {
    const sid = storeId.trim();
    if (!Types.ObjectId.isValid(sid)) return;
    await this.prefsModel
      .updateOne(
        { store: new Types.ObjectId(sid) },
        {
          $set: {
            smsBillingSuspended: false,
            smsBillingSuspendedAt: null,
            smsBillingSuspendReason: null,
          },
        },
      )
      .exec();
  }

  private mergeWithDefaults(
    raw: VendorNotificationPreferencesMap | null,
  ): VendorNotificationPreferencesMap {
    const defaults = defaultVendorNotificationPreferences();
    if (!raw || typeof raw !== 'object') return defaults;
    const out = { ...defaults };
    for (const cat of VENDOR_NOTIFICATION_CATEGORIES) {
      const row = raw[cat];
      if (row && typeof row === 'object') {
        out[cat] = normalizeChannelPrefs(row, defaults[cat]);
      }
    }
    return out;
  }

  private async assertCanManageStore(
    user: UserModel,
    storeId: string,
  ): Promise<void> {
    const sid = storeId.trim();
    if (!Types.ObjectId.isValid(sid)) {
      throw new BadRequestException('invalid_store_id');
    }
    if (user.type === UserTypeEnum.ADMIN) return;
    await this.storeAccess.assertStoreAccess(user, sid);
  }
}
