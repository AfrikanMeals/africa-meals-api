import {
  ALL_STORE_PERMISSIONS,
  isStorePermission,
  StorePermission,
  storePermissionGranted,
  STORE_PERMISSION_GROUPS,
  STORE_PERMISSION_LABELS,
} from '../../common/permissions/store-permissions';
import {
  adminPermissionGranted,
  ALL_ADMIN_PERMISSIONS,
  isAdminPermission,
  ADMIN_PERMISSION_GROUPS,
  ADMIN_PERMISSION_LABELS,
} from '../../common/permissions/admin-permissions';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PlatformRoleModel } from '@schemas/platform-role.schema';
import { StoreMemberModel } from '@schemas/store-member.schema';
import { StoreRoleModel } from '@schemas/store-role.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  normalizePlatformRoleIds,
  normalizeStoreMemberRoleIds,
  unionStorePermissionsFromRoles,
} from './teams-role-ids.util';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';

export type StoreAccessEntry = {
  storeId: string;
  storeName: string;
  roleIds: string[];
  roleNames: string[];
  /** Premier rôle (rétrocompatibilité). */
  roleId: string;
  /** Libellés concaténés (rétrocompatibilité). */
  roleName: string;
  permissions: StorePermission[];
  isOwner: boolean;
  isFreePlan: boolean;
  marketingToolsPlanEnabled: boolean;
};

@Injectable()
export class StoreAccessService {
  // Cycle Nest : StoreAccess ↔ Subscriptions ↔ Notifications.
  @Inject(forwardRef(() => SubscriptionsService))
  private readonly subscriptionsService: SubscriptionsService;

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
    const roleIds = normalizePlatformRoleIds(
      user as {
        platformRoleId?: Types.ObjectId;
        platformRoleIds?: Types.ObjectId[];
      },
    );
    if (!roleIds.length) {
      return [...ALL_ADMIN_PERMISSIONS];
    }
    const roles = await this.platformRoleModel
      .find({ _id: { $in: roleIds } })
      .lean()
      .exec();
    if (!roles.length) return [...ALL_ADMIN_PERMISSIONS];
    if (roles.some((r) => r.isSuper)) return [...ALL_ADMIN_PERMISSIONS];
    const set = new Set<string>();
    for (const role of roles) {
      for (const p of role.permissions ?? []) {
        if (isAdminPermission(p)) set.add(p);
      }
    }
    return [...set];
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
    if (
      isAdminPermission(permission)
        ? !adminPermissionGranted(perms, permission)
        : !perms.includes(permission)
    ) {
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
        roleIds: ['admin'],
        roleNames: ['Administrateur'],
        roleId: 'admin',
        roleName: 'Administrateur',
        permissions: [...ALL_STORE_PERMISSIONS],
        isOwner: false,
        isFreePlan: false,
        marketingToolsPlanEnabled: true,
      }));
    }

    const userId = user._id as Types.ObjectId;
    const entries: StoreAccessEntry[] = [];
    const accessibleOwnedStoreIds = new Set(
      await this.subscriptionsService.resolveAccessibleStoreIdsForOwner(userId),
    );

    const owned = await this.storeModel
      .find({ owner: userId })
      .select('name')
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();
    for (const s of owned) {
      const storeId = String(s._id);
      if (!accessibleOwnedStoreIds.has(storeId)) continue;
      const ownerRole = await this.storeRoleModel
        .findOne({ store: storeId, isOwnerRole: true })
        .lean()
        .exec();
      const ownerRoleId = ownerRole ? String(ownerRole._id) : '';
      const ownerRoleName = ownerRole?.name ?? 'Propriétaire';
      entries.push({
        storeId,
        storeName: String(s.name ?? ''),
        roleIds: ownerRoleId ? [ownerRoleId] : [],
        roleNames: [ownerRoleName],
        roleId: ownerRoleId,
        roleName: ownerRoleName,
        permissions: [...ALL_STORE_PERMISSIONS],
        isOwner: true,
        isFreePlan: false,
        marketingToolsPlanEnabled: false,
      });
    }

    const memberships = await this.storeMemberModel
      .find({ user: userId, status: 'ACTIVE' })
      .lean()
      .exec();
    const allRoleIds = memberships.flatMap((m) =>
      normalizeStoreMemberRoleIds(
        m as { role?: Types.ObjectId; roles?: Types.ObjectId[] },
      ),
    );
    const roles = await this.storeRoleModel
      .find({ _id: { $in: allRoleIds } })
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
    const ownerIds = [
      ...new Set(
        stores
          .map((s) => String((s as { owner?: unknown }).owner ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const allowedStoreIdsByOwner = new Map<string, Set<string>>();
    for (const ownerId of ownerIds) {
      const ids =
        await this.subscriptionsService.resolveAccessibleStoreIdsForOwner(
          ownerId,
        );
      allowedStoreIdsByOwner.set(ownerId, new Set(ids));
    }

    for (const m of memberships) {
      const storeId = String(m.store);
      if (entries.some((e) => e.storeId === storeId)) continue;
      const store = storeById.get(storeId);
      // Ignore les memberships orphelins: boutique supprimée/inexistante.
      if (!store) continue;
      const storeOwnerId = String((store as { owner?: unknown })?.owner ?? '');
      const allowedForOwner = allowedStoreIdsByOwner.get(storeOwnerId);
      if (allowedForOwner && !allowedForOwner.has(storeId)) {
        continue;
      }
      const memberRoleIds = normalizeStoreMemberRoleIds(
        m as { role?: Types.ObjectId; roles?: Types.ObjectId[] },
      );
      const memberRoles = memberRoleIds
        .map((rid) => roleById.get(String(rid)))
        .filter((r): r is NonNullable<typeof r> => r != null);
      const roleIds = memberRoles.map((r) => String(r._id));
      const roleNames = memberRoles.map((r) => String(r.name ?? ''));
      entries.push({
        storeId,
        storeName: String(store?.name ?? ''),
        roleIds,
        roleNames,
        roleId: roleIds[0] ?? '',
        roleName: roleNames.join(', '),
        permissions: unionStorePermissionsFromRoles(memberRoles),
        isOwner: false,
        isFreePlan: false,
        marketingToolsPlanEnabled: false,
      });
    }

    for (const entry of entries) {
      entry.isFreePlan = await this.subscriptionsService.isStoreOnFreePlan(
        entry.storeId,
      );
      entry.marketingToolsPlanEnabled =
        await this.subscriptionsService.isMarketingToolsEnabledForStore(
          entry.storeId,
        );
    }

    return entries;
  }

  async getStorePermissions(
    user: UserModel,
    storeId: string,
  ): Promise<StorePermission[]> {
    if (user.type === UserTypeEnum.ADMIN) {
      const exists = await this.storeModel
        .findById(storeId)
        .select('_id')
        .lean()
        .exec();
      if (exists) return [...ALL_STORE_PERMISSIONS];
      return [];
    }
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
    return storePermissionGranted(perms, permission);
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
      .select('_id owner')
      .lean()
      .exec();
    if (!exists) throw new NotFoundException('store_not_found');

    const perms = await this.getStorePermissions(user, storeId);
    if (!perms.length) {
      if (user.type === UserTypeEnum.VENDOR) {
        const ownerId = String((exists as { owner?: unknown }).owner ?? '');
        const userId = String(user._id ?? '');
        if (ownerId && ownerId === userId) {
          const allowedStoreIds =
            await this.subscriptionsService.resolveAccessibleStoreIdsForOwner(
              user._id as Types.ObjectId,
            );
          if (!allowedStoreIds.includes(storeId)) {
            throw new ForbiddenException('store_locked_by_plan_limit');
          }
        }
      }
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

  /** Propriétaire de la boutique uniquement (pas équipe ni admins plateforme). */
  async resolveStoreOwnerUserId(storeId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(storeId)) return null;
    const sto = await this.storeModel
      .findById(new Types.ObjectId(storeId.trim()))
      .select('owner')
      .lean()
      .exec();
    return this.userIdFromRef(sto?.owner);
  }

  /**
   * Utilisateurs à notifier par FCM pour une boutique (propriétaire + équipe active + admins commandes).
   */
  async listStorePushRecipientUserIds(storeId: string): Promise<string[]> {
    const ids = new Set<string>(
      await this.listStoreTeamRecipientUserIds(storeId),
    );
    if (!ids.size && !Types.ObjectId.isValid(storeId)) {
      return [];
    }
    const platformAdminIds = await this.listPlatformOrderPushRecipientUserIds();
    for (const adminId of platformAdminIds) {
      ids.add(adminId);
    }
    return [...ids].filter((id) => Types.ObjectId.isValid(id));
  }

  /**
   * Propriétaire + équipe active de la boutique — SANS admins plateforme.
   * À utiliser pour les e-mails (les admins ne doivent pas recevoir un e-mail
   * à chaque changement de statut de commande).
   */
  async listStoreTeamRecipientUserIds(storeId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(storeId)) {
      return [];
    }
    const sid = new Types.ObjectId(storeId);
    const ids = new Set<string>();
    const sto = await this.storeModel
      .findById(sid)
      .select('owner')
      .lean()
      .exec();
    const ownerId = this.userIdFromRef(sto?.owner);
    if (ownerId) {
      ids.add(ownerId);
    }
    const members = await this.storeMemberModel
      .find({ store: sid, status: 'ACTIVE' })
      .select('user')
      .lean()
      .exec();
    for (const m of members) {
      const memberId = this.userIdFromRef(m.user);
      if (memberId) {
        ids.add(memberId);
      }
    }
    return [...ids].filter((id) => Types.ObjectId.isValid(id));
  }

  /**
   * Admins plateforme avec accès commandes — alertes push nouvelles commandes (admin web).
   */
  async listPlatformOrderPushRecipientUserIds(): Promise<string[]> {
    const matchingRoleIds = new Set<string>();
    const roles = await this.platformRoleModel
      .find()
      .select('_id isSuper permissions')
      .lean()
      .exec();
    for (const role of roles) {
      const roleId = String(role._id);
      if (role.isSuper) {
        matchingRoleIds.add(roleId);
        continue;
      }
      const rolePerms = (role.permissions ?? []).filter(
        (p): p is string => typeof p === 'string',
      );
      if (adminPermissionGranted(rolePerms, 'admin.orders')) {
        matchingRoleIds.add(roleId);
      }
    }

    const admins = await this.userModel
      .find({ type: UserTypeEnum.ADMIN })
      .select('_id platformRoleId platformRoleIds')
      .lean()
      .exec();
    const ids = new Set<string>();
    for (const admin of admins) {
      const roleIds = normalizePlatformRoleIds(
        admin as {
          platformRoleId?: Types.ObjectId;
          platformRoleIds?: Types.ObjectId[];
        },
      );
      if (!roleIds.length) {
        ids.add(String(admin._id));
        continue;
      }
      if (roleIds.some((rid) => matchingRoleIds.has(String(rid)))) {
        ids.add(String(admin._id));
      }
    }
    return [...ids].filter((id) => Types.ObjectId.isValid(id));
  }

  /**
   * Libellés de rôle boutique pour des paires (userId, storeId) — journal d’audit.
   */
  async resolveStoreRoleLabelsForActors(
    pairs: Array<{ userId: string; storeId: string }>,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!pairs.length) return map;

    const storeIds = [
      ...new Set(
        pairs
          .map((p) => p.storeId)
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const userIds = [
      ...new Set(
        pairs
          .map((p) => p.userId)
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    if (!storeIds.length || !userIds.length) return map;

    const storeOids = storeIds.map((id) => new Types.ObjectId(id));
    const userOids = userIds.map((id) => new Types.ObjectId(id));

    const stores = await this.storeModel
      .find({ _id: { $in: storeOids } })
      .select('owner')
      .lean()
      .exec();
    const ownerByStore = new Map(
      stores.map((s) => [String(s._id), String(s.owner ?? '')]),
    );

    const members = await this.storeMemberModel
      .find({
        store: { $in: storeOids },
        user: { $in: userOids },
        status: 'ACTIVE',
      })
      .lean()
      .exec();

    const allRoleIds = members.flatMap((m) =>
      normalizeStoreMemberRoleIds(
        m as { role?: Types.ObjectId; roles?: Types.ObjectId[] },
      ),
    );
    const roles = allRoleIds.length
      ? await this.storeRoleModel
          .find({ _id: { $in: allRoleIds } })
          .lean()
          .exec()
      : [];
    const roleById = new Map(roles.map((r) => [String(r._id), r]));

    for (const { userId, storeId } of pairs) {
      const key = `${userId}:${storeId}`;
      if (map.has(key)) continue;

      if (ownerByStore.get(storeId) === userId) {
        map.set(key, 'Propriétaire');
        continue;
      }

      const member = members.find(
        (m) => String(m.user) === userId && String(m.store) === storeId,
      );
      if (!member) {
        map.set(key, 'Vendeur');
        continue;
      }

      const memberRoleIds = normalizeStoreMemberRoleIds(
        member as { role?: Types.ObjectId; roles?: Types.ObjectId[] },
      );
      const memberRoles = memberRoleIds
        .map((rid) => roleById.get(String(rid)))
        .filter((r): r is NonNullable<typeof r> => r != null);

      if (memberRoles.some((r) => r.isOwnerRole === true)) {
        map.set(key, 'Propriétaire');
      } else if (memberRoles[0]?.name) {
        map.set(key, String(memberRoles[0].name));
      } else {
        map.set(key, 'Membre');
      }
    }

    return map;
  }

  /** ObjectId utilisateur depuis une ref lean (ObjectId, string ou document peuplé). */
  private userIdFromRef(raw: unknown): string | null {
    if (raw == null) return null;
    if (raw instanceof Types.ObjectId) {
      return raw.toHexString();
    }
    if (typeof raw === 'object' && '_id' in (raw as object)) {
      const id = (raw as { _id: unknown })._id;
      if (id instanceof Types.ObjectId) {
        return id.toHexString();
      }
      const s = String(id ?? '').trim();
      return Types.ObjectId.isValid(s) ? s : null;
    }
    const s = String(raw).trim();
    return Types.ObjectId.isValid(s) ? s : null;
  }
}
