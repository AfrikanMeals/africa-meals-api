import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { GraphSyncQueueService } from '@modules/graph/graph-sync-queue.service';
import {
  StoreSubscriberDocument,
  StoreSubscriberModel,
} from '@schemas/store-subscriber.schema';
import { StoreModel, StoreModelDocument } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

export type StoreSubscriberStats = {
  total: number;
  last7Days: number;
  last30Days: number;
};

export type SubscribedStoreRow = {
  storeId: string;
  storeName: string;
  profileImage: string;
  subscribedAt: string;
};

export type StoreSubscriberRow = {
  userId: string;
  fullName: string;
  email: string;
  subscribedAt: string;
};

@Injectable()
export class StoreSubscribersService {
  constructor(
    @InjectModel(StoreSubscriberModel.name)
    private readonly _subscriberModel: Model<StoreSubscriberDocument>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModelDocument>,
    private readonly _subscriptionsService: SubscriptionsService,
    private readonly _storeAccess: StoreAccessService,
    @Optional()
    private readonly _graphSyncQueue?: GraphSyncQueueService,
  ) {}

  private _userId(user: UserModel): string {
    return String(user._id ?? '').trim();
  }

  private async _assertStoreVisible(storeId: string) {
    if (!Types.ObjectId.isValid(storeId)) {
      throw new NotFoundException('store_not_found');
    }
    const store = await this._storeModel
      .findById(storeId)
      .select('_id name status')
      .lean()
      .exec();
    if (!store) throw new NotFoundException('store_not_found');
    return store;
  }

  private async _assertStoreSubscriptionFeature(storeId: string) {
    await this._assertStoreVisible(storeId);
    const planMap =
      await this._subscriptionsService.resolveActivePlanNamesByStoreIds([
        storeId,
      ]);
    const planName = planMap.get(storeId) ?? 'FREE';
    const enabled =
      await this._subscriptionsService.isStoreSubscriptionEnabledForPlanName(
        planName,
      );
    if (!enabled) {
      throw new ForbiddenException('store_subscription_not_available');
    }
  }

  private async _assertVendorCanViewStore(storeId: string, user: UserModel) {
    if (user.type === UserTypeEnum.ADMIN) return;
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    await this._storeAccess.assertStorePermission(
      user,
      storeId,
      'customers.view',
    );
  }

  async subscribe(storeId: string, user: UserModel) {
    if (user.type !== UserTypeEnum.USER) {
      throw new ForbiddenException('customer_only');
    }
    await this._assertStoreSubscriptionFeature(storeId);
    const uid = this._userId(user);
    const storeOid = new Types.ObjectId(storeId);
    const userOid = new Types.ObjectId(uid);
    try {
      await this._subscriberModel.create({ store: storeOid, user: userOid });
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code === 11000) {
        throw new ConflictException('already_subscribed');
      }
      throw e;
    }
    if (this._graphSyncQueue) {
      void this._graphSyncQueue
        .enqueueStoreSubscribed({
          userId: uid,
          storeId,
          at: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
    return { subscribed: true, storeId };
  }

  async unsubscribe(storeId: string, user: UserModel) {
    if (user.type !== UserTypeEnum.USER) {
      throw new ForbiddenException('customer_only');
    }
    const uid = this._userId(user);
    const result = await this._subscriberModel
      .deleteOne({
        store: new Types.ObjectId(storeId),
        user: new Types.ObjectId(uid),
      })
      .exec();
    return { subscribed: false, removed: (result.deletedCount ?? 0) > 0 };
  }

  async isSubscribed(storeId: string, user: UserModel): Promise<boolean> {
    const uid = this._userId(user);
    if (!uid || !Types.ObjectId.isValid(storeId)) return false;
    const row = await this._subscriberModel
      .exists({
        store: new Types.ObjectId(storeId),
        user: new Types.ObjectId(uid),
      })
      .exec();
    return row != null;
  }

  async listSubscribedStoreIds(user: UserModel): Promise<string[]> {
    const uid = this._userId(user);
    if (!uid || !Types.ObjectId.isValid(uid)) return [];
    const rows = await this._subscriberModel
      .find({ user: new Types.ObjectId(uid) })
      .select('store')
      .lean()
      .exec();
    return (rows as Record<string, unknown>[])
      .map((row) => String(row.store ?? '').trim())
      .filter((id) => Types.ObjectId.isValid(id));
  }

  async listSubscribedStores(user: UserModel): Promise<SubscribedStoreRow[]> {
    const uid = this._userId(user);
    const rows = await this._subscriberModel
      .find({ user: new Types.ObjectId(uid) })
      .sort({ createdAt: -1 })
      .populate({
        path: 'store',
        select: 'name profileImage status',
      })
      .lean()
      .exec();

    return (rows as Record<string, unknown>[]).flatMap((row) => {
      const store = row.store as Record<string, unknown> | null;
      if (!store || store.status === 'INACTIVE') return [];
      const sid = String(store._id ?? '');
      if (!sid) return [];
      return [
        {
          storeId: sid,
          storeName: String(store.name ?? '').trim(),
          profileImage: String(store.profileImage ?? '').trim(),
          subscribedAt: new Date(String(row.createdAt ?? '')).toISOString(),
        },
      ];
    });
  }

  async statsForStore(
    storeId: string,
    user: UserModel,
  ): Promise<StoreSubscriberStats> {
    await this._assertVendorCanViewStore(storeId, user);
    const storeOid = new Types.ObjectId(storeId);
    const now = Date.now();
    const d7 = new Date(now - 7 * 86400000);
    const d30 = new Date(now - 30 * 86400000);
    const [total, last7Days, last30Days] = await Promise.all([
      this._subscriberModel.countDocuments({ store: storeOid }).exec(),
      this._subscriberModel
        .countDocuments({ store: storeOid, createdAt: { $gte: d7 } })
        .exec(),
      this._subscriberModel
        .countDocuments({ store: storeOid, createdAt: { $gte: d30 } })
        .exec(),
    ]);
    return { total, last7Days, last30Days };
  }

  async listForStore(
    storeId: string,
    user: UserModel,
  ): Promise<StoreSubscriberRow[]> {
    await this._assertVendorCanViewStore(storeId, user);
    const rows = await this._subscriberModel
      .find({ store: new Types.ObjectId(storeId) })
      .sort({ createdAt: -1 })
      .populate({
        path: 'user',
        select: 'fullName email',
      })
      .lean()
      .exec();

    return (rows as Record<string, unknown>[]).map((row) => {
      const u = row.user as Record<string, unknown> | null;
      return {
        userId: String(u?._id ?? ''),
        fullName: String(u?.fullName ?? '').trim(),
        email: String(u?.email ?? '').trim(),
        subscribedAt: new Date(String(row.createdAt ?? '')).toISOString(),
      };
    });
  }
}
