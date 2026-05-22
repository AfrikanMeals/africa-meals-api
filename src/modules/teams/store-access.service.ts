import {
  ALL_STORE_PERMISSIONS,
  isStorePermission,
  StorePermission,
} from '../../common/permissions/store-permissions';
import {
  ALL_ADMIN_PERMISSIONS,
  isAdminPermission,
} from '../../common/permissions/admin-permissions';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PlatformRoleModel } from '@schemas/platform-role.schema';
import { StoreMemberModel } from '@schemas/store-member.schema';
import { StoreRoleModel } from '@schemas/store-role.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

export type StoreAccessEntry = {
  storeId: string;
  storeName: string;
  roleId: string;
  roleName: string;
  permissions: StorePermission[];
  isOwner: boolean;
};

@Injectable()
export class StoreAccessService {
  @InjectModel(StoreModel.name)
  private readonly storeModel: Model<StoreModel>;

  @InjectModel(StoreRoleModel.name)
  private readonly storeRoleModel: Model<StoreRoleModel>;

  @InjectModel(StoreMemberModel.name)
  private readonly storeMemberModel: Model<StoreMemberModel>;

  @InjectModel(PlatformRoleModel.name)
  private readonly platformRoleModel: Model<PlatformRoleModel>;

  @InjectModel(UserModel.name)
  private readonly userModel: Model<UserModel>;

  async listAdminPermissions(user: UserModel): Promise<string[]> {
    if (user.type !== UserTypeEnum.ADMIN) return [];
    const roleId = (user as { platformRoleId?: Types.ObjectId }).platformRoleId;
    if (!roleId) {
      return [...ALL_ADMIN_PERMISSIONS];
    }
    const role = await this.platformRoleModel.findById(roleId).lean().exec();
    if (!role) return [...ALL_ADMIN_PERMISSIONS];
    if (role.isSuper) return [...ALL_ADMIN_PERMISSIONS];
    return (role.permissions ?? []).filter(isAdminPermission);
  }

  hasAdminPermission(user: UserModel, permission: string): boolean {
    if (user.type !== UserTypeEnum.ADMIN) return false;
    return true; // filled async in assert — use async version
  }

  async assertAdminPermission(
    user: UserModel,
    permission: string,
  ): Promise<void> {
    const perms = await this.listAdminPermissions(user);
    if (!perms.includes(permission)) {
      throw new ForbiddenException('permission_denied');
    }
  }

  async resolveStoreAccess(user: UserModel): Promise<StoreAccessEntry[]> {
    if (user.type === UserTypeEnum.ADMIN) {
      const stores = await this.storeModel
        .find({})
        .select('name')
        .limit(500)
        .lean()
        .exec();
      return stores.map((s) => ({
        storeId: String(s._id),
        storeName: String(s.name ?? ''),
        roleId: 'admin',
        roleName: 'Administrateur',
        permissions: [...ALL_STORE_PERMISSIONS],
        isOwner: false,
      }));
    }

    const userId = user._id;
    const entries: StoreAccessEntry[] = [];

    const owned = await this.storeModel
      .find({ owner: userId })
      .select('name')
      .lean()
      .exec();
    for (const s of owned) {
      const storeId = String(s._id);
      const ownerRole = await this.storeRoleModel
        .findOne({ store: storeId, isOwnerRole: true })
        .lean()
        .exec();
      entries.push({
        storeId,
        storeName: String(s.name ?? ''),
        roleId: ownerRole ? String(ownerRole._id) : '',
        roleName: ownerRole?.name ?? 'Propriétaire',
        permissions: [...ALL_STORE_PERMISSIONS],
        isOwner: true,
      });
    }

    const memberships = await this.storeMemberModel
      .find({ user: userId, status: 'ACTIVE' })
      .lean()
      .exec();
    const roleIds = memberships.map((m) => m.role);
    const roles = await this.storeRoleModel
      .find({ _id: { $in: roleIds } })
      .lean()
      .exec();
    const roleById = new Map(roles.map((r) => [String(r._id), r]));
    const storeIds = memberships.map((m) => m.store);
    const stores = await this.storeModel
      .find({ _id: { $in: storeIds } })
      .select('name owner')
      .lean()
      .exec();
    const storeById = new Map(stores.map((s) => [String(s._id), s]));

    for (const m of memberships) {
      const storeId = String(m.store);
      if (entries.some((e) => e.storeId === storeId)) continue;
      const store = storeById.get(storeId);
      const role = roleById.get(String(m.role));
      const perms = (role?.permissions ?? []).filter(isStorePermission);
      entries.push({
        storeId,
        storeName: String(store?.name ?? ''),
        roleId: role ? String(role._id) : '',
        roleName: role?.name ?? '',
        permissions: perms,
        isOwner: false,
      });
    }

    return entries;
  }

  async getStorePermissions(
    user: UserModel,
    storeId: string,
  ): Promise<StorePermission[]> {
    const access = await this.resolveStoreAccess(user);
    const row = access.find((a) => a.storeId === storeId);
    return row?.permissions ?? [];
  }

  async hasStorePermission(
    user: UserModel,
    storeId: string,
    permission: StorePermission,
  ): Promise<boolean> {
    const perms = await this.getStorePermissions(user, storeId);
    return perms.includes(permission);
  }

  async assertStorePermission(
    user: UserModel,
    storeId: string,
    permission: StorePermission,
  ): Promise<void> {
    const ok = await this.hasStorePermission(user, storeId, permission);
    if (!ok) {
      throw new ForbiddenException('permission_denied');
    }
  }

  async assertStoreAccess(
    user: UserModel,
    storeId: string,
    permission?: StorePermission,
  ): Promise<void> {
    const exists = await this.storeModel
      .findById(storeId)
      .select('_id')
      .lean()
      .exec();
    if (!exists) throw new NotFoundException('store_not_found');

    const perms = await this.getStorePermissions(user, storeId);
    if (!perms.length) {
      throw new NotFoundException('store_not_found');
    }
    if (permission) {
      await this.assertStorePermission(user, storeId, permission);
    }
  }

  async accessibleStoreIds(user: UserModel): Promise<Types.ObjectId[]> {
    const access = await this.resolveStoreAccess(user);
    return access
      .map((a) => a.storeId)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
  }
}
