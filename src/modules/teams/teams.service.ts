import {
  ADMIN_PERMISSION_LABELS,
  ALL_ADMIN_PERMISSIONS,
  DEFAULT_ADMIN_ROLE_TEMPLATES,
  isAdminPermission,
} from '../../common/permissions/admin-permissions';
import {
  ALL_STORE_PERMISSIONS,
  DEFAULT_STORE_ROLE_TEMPLATES,
  isStorePermission,
  sortStoreRolesByTemplate,
  STORE_PERMISSION_LABELS,
} from '../../common/permissions/store-permissions';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PlatformRoleModel } from '@schemas/platform-role.schema';
import { StoreMemberModel } from '@schemas/store-member.schema';
import { StoreRoleModel } from '@schemas/store-role.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  AddStoreMemberDto,
  AssignPlatformRoleDto,
  CreatePlatformRoleDto,
  CreateStoreRoleDto,
  UpdatePlatformRoleDto,
  UpdateStoreMemberDto,
  UpdateStoreRoleDto,
} from './dto/teams.dto';
import { StoreAccessService } from './store-access.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import {
  normalizePlatformRoleIds,
  normalizeStoreMemberRoleIds,
  resolvePlatformRoleIdsFromDto,
  resolveRoleIdsFromDto,
} from './teams-role-ids.util';

function mapStoreRole(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    storeId: String(doc.store),
    name: String(doc.name ?? ''),
    description: String(doc.description ?? ''),
    permissions: Array.isArray(doc.permissions)
      ? doc.permissions.map((p) => String(p))
      : [],
    templateKey: doc.templateKey ? String(doc.templateKey) : undefined,
    isOwnerRole: doc.isOwnerRole === true,
    isSystem: doc.isSystem === true,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapStoreMember(
  doc: Record<string, unknown>,
  extras?: {
    userEmail?: string;
    userName?: string;
    roleNames?: string[];
  },
) {
  const roleIds = normalizeStoreMemberRoleIds(
    doc as { role?: Types.ObjectId; roles?: Types.ObjectId[] },
  ).map((id) => String(id));
  const roleNames = extras?.roleNames ?? [];
  return {
    id: String(doc._id),
    storeId: String(doc.store),
    userId: String(doc.user),
    roleIds,
    roleNames,
    roleId: roleIds[0] ?? '',
    roleName: roleNames.join(', '),
    status: String(doc.status),
    userEmail: extras?.userEmail ?? '',
    userName: extras?.userName ?? '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapPlatformRole(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    description: String(doc.description ?? ''),
    permissions: Array.isArray(doc.permissions)
      ? doc.permissions.map((p) => String(p))
      : [],
    templateKey: doc.templateKey ? String(doc.templateKey) : undefined,
    isSuper: doc.isSuper === true,
    isSystem: doc.isSystem === true,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class TeamsService {
  @Inject(StoreAccessService)
  private readonly storeAccess: StoreAccessService;

  @Inject(SubscriptionsService)
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

  getPermissionsCatalog() {
    return {
      store: ALL_STORE_PERMISSIONS.map((key) => ({
        key,
        label: STORE_PERMISSION_LABELS[key],
      })),
      admin: ALL_ADMIN_PERMISSIONS.map((key) => ({
        key,
        label: ADMIN_PERMISSION_LABELS[key],
      })),
    };
  }

  async buildAccessPayload(user: UserModel) {
    const storeAccess = await this.storeAccess.resolveStoreAccess(user);
    const adminPermissions =
      user.type === UserTypeEnum.ADMIN
        ? await this.storeAccess.listAdminPermissions(user)
        : [];
    const platformRoles: ReturnType<typeof mapPlatformRole>[] = [];
    if (user.type === UserTypeEnum.ADMIN) {
      const roleIds = normalizePlatformRoleIds(
        user as {
          platformRoleId?: Types.ObjectId;
          platformRoleIds?: Types.ObjectId[];
        },
      );
      if (roleIds.length) {
        const roles = await this.platformRoleModel
          .find({ _id: { $in: roleIds } })
          .lean()
          .exec();
        for (const role of roles) {
          platformRoles.push(mapPlatformRole(role as Record<string, unknown>));
        }
      }
    }
    const planDowngradeImpact =
      user.type === UserTypeEnum.VENDOR
        ? await this.subscriptionsService.resolvePlanDowngradeImpactForOwner(
            user._id as Types.ObjectId,
          )
        : { hiddenStores: 0, hiddenCatalogItems: 0 };
    return {
      storeAccess,
      adminPermissions,
      platformRole: platformRoles[0] ?? null,
      platformRoles,
      planDowngradeImpact,
    };
  }

  /** Crée les rôles système manquants (idempotent). Les rôles personnalisés restent possibles via `createStoreRole`. */
  private async ensureStoreSystemRoles(storeId: Types.ObjectId) {
    for (const tpl of DEFAULT_STORE_ROLE_TEMPLATES) {
      const existing = await this.storeRoleModel
        .findOne({ store: storeId, templateKey: tpl.key })
        .exec();
      if (existing) {
        if (tpl.isOwner) {
          existing.name = tpl.name;
          existing.description = tpl.description;
          existing.isOwnerRole = true;
          await existing.save();
        }
        continue;
      }
      await this.storeRoleModel.create({
        store: storeId,
        name: tpl.name,
        description: tpl.description,
        permissions: tpl.permissions,
        templateKey: tpl.key,
        isOwnerRole: tpl.isOwner === true,
        isSystem: true,
      });
    }
  }

  async bootstrapStoreTeam(storeId: string, ownerUserId: Types.ObjectId) {
    const sid = new Types.ObjectId(storeId);
    await this.ensureStoreSystemRoles(sid);

    const ownerRole = await this.storeRoleModel
      .findOne({ store: sid, isOwnerRole: true })
      .exec();
    if (!ownerRole) {
      throw new BadRequestException('owner_role_missing');
    }

    const existingMember = await this.storeMemberModel
      .findOne({ store: sid, user: ownerUserId })
      .exec();
    if (!existingMember) {
      await this.storeMemberModel.create({
        store: sid,
        user: ownerUserId,
        roles: [ownerRole._id],
        status: 'ACTIVE',
      });
    }
  }

  async ensurePlatformRolesSeeded() {
    const count = await this.platformRoleModel.countDocuments().exec();
    if (count > 0) return;
    for (const tpl of DEFAULT_ADMIN_ROLE_TEMPLATES) {
      await this.platformRoleModel.create({
        name: tpl.name,
        description: '',
        permissions: tpl.permissions,
        templateKey: tpl.key,
        isSuper: tpl.isSuper === true,
        isSystem: true,
      });
    }
  }

  private async resolveStoreRoleObjectIds(
    storeId: string,
    dto: { roleId?: string; roleIds?: string[] },
  ): Promise<Types.ObjectId[]> {
    const ids = resolveRoleIdsFromDto(dto);
    if (!ids.length) {
      throw new BadRequestException('role_ids_required');
    }
    const roles = await this.storeRoleModel
      .find({ _id: { $in: ids }, store: storeId })
      .exec();
    if (roles.length !== ids.length) {
      throw new NotFoundException('role_not_found');
    }
    if (roles.some((r) => r.isOwnerRole)) {
      throw new BadRequestException('cannot_assign_owner_role');
    }
    return roles.map((r) => r._id as Types.ObjectId);
  }

  private async resolveVendorStoreId(user: UserModel): Promise<string> {
    const access = await this.storeAccess.resolveStoreAccess(user);
    const first = access[0];
    if (!first) throw new BadRequestException('no_store');
    return first.storeId;
  }

  private async assertTeamFeatureAvailableForStore(
    storeId: string,
  ): Promise<void> {
    const isFree = await this.subscriptionsService.isStoreOnFreePlan(storeId);
    if (isFree) {
      throw new ForbiddenException('team_feature_not_available_on_free_plan');
    }
  }

  async listStoreRoles(user: UserModel, storeId: string) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.view');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const store = await this.storeModel.findById(storeId).lean().exec();
    if (!store) throw new NotFoundException('store_not_found');
    await this.bootstrapStoreTeam(
      storeId,
      new Types.ObjectId(String(store.owner)),
    );

    const rows = await this.storeRoleModel
      .find({ store: storeId })
      .lean()
      .exec();
    const sorted = sortStoreRolesByTemplate(
      rows as Array<{
        templateKey?: string;
        isOwnerRole?: boolean;
        name?: string;
      }>,
    );
    return (sorted as Record<string, unknown>[]).map(mapStoreRole);
  }

  async createStoreRole(
    user: UserModel,
    storeId: string,
    dto: CreateStoreRoleDto,
  ) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const perms = dto.permissions.filter(isStorePermission);
    if (!perms.length) {
      throw new BadRequestException('invalid_permissions');
    }
    const doc = await this.storeRoleModel.create({
      store: storeId,
      name: dto.name.trim(),
      description: (dto.description ?? '').trim(),
      permissions: perms,
      isSystem: false,
      isOwnerRole: false,
    });
    return mapStoreRole(doc.toObject() as Record<string, unknown>);
  }

  async updateStoreRole(
    user: UserModel,
    storeId: string,
    roleId: string,
    dto: UpdateStoreRoleDto,
  ) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const role = await this.storeRoleModel
      .findOne({ _id: roleId, store: storeId })
      .exec();
    if (!role) throw new NotFoundException('role_not_found');
    if (role.isOwnerRole) {
      throw new ForbiddenException('cannot_edit_owner_role');
    }
    if (role.isSystem && dto.name != null) {
      throw new ForbiddenException('cannot_rename_system_role');
    }
    if (dto.name != null) role.name = dto.name.trim();
    if (dto.description != null) role.description = dto.description.trim();
    if (dto.permissions != null) {
      const perms = dto.permissions.filter(isStorePermission);
      if (!perms.length) throw new BadRequestException('invalid_permissions');
      role.permissions = perms;
    }
    await role.save();
    return mapStoreRole(role.toObject() as Record<string, unknown>);
  }

  async deleteStoreRole(user: UserModel, storeId: string, roleId: string) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const role = await this.storeRoleModel
      .findOne({ _id: roleId, store: storeId })
      .exec();
    if (!role) throw new NotFoundException('role_not_found');
    if (role.isOwnerRole || role.isSystem) {
      throw new ForbiddenException('cannot_delete_system_role');
    }
    const inUse = await this.storeMemberModel.countDocuments({
      store: storeId,
      status: 'ACTIVE',
      $or: [{ role: roleId }, { roles: roleId }],
    });
    if (inUse > 0) {
      throw new ConflictException('role_in_use');
    }
    await role.deleteOne();
    return { ok: true };
  }

  async listStoreMembers(user: UserModel, storeId: string) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.view');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const store = await this.storeModel.findById(storeId).lean().exec();
    if (!store) throw new NotFoundException('store_not_found');
    await this.bootstrapStoreTeam(
      storeId,
      new Types.ObjectId(String(store.owner)),
    );

    const rows = await this.storeMemberModel
      .find({ store: storeId, status: 'ACTIVE' })
      .lean()
      .exec();
    const userIds = rows.map((r) => r.user);
    const roleIds = rows.flatMap((r) =>
      normalizeStoreMemberRoleIds(
        r as { role?: Types.ObjectId; roles?: Types.ObjectId[] },
      ),
    );
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('fullName email')
      .lean()
      .exec();
    const roles = await this.storeRoleModel
      .find({ _id: { $in: roleIds } })
      .lean()
      .exec();
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const roleById = new Map(roles.map((r) => [String(r._id), r]));

    const owner = await this.userModel
      .findById(store.owner)
      .select('fullName email')
      .lean()
      .exec();
    const ownerRole = await this.storeRoleModel
      .findOne({ store: storeId, isOwnerRole: true })
      .lean()
      .exec();

    const members = (rows as Record<string, unknown>[]).map((r) => {
      const uid = String(r.user);
      const u = userById.get(uid);
      const memberRoleIds = normalizeStoreMemberRoleIds(
        r as { role?: Types.ObjectId; roles?: Types.ObjectId[] },
      );
      const roleNames = memberRoleIds
        .map((rid) => roleById.get(String(rid))?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
      return mapStoreMember(r, {
        userEmail: String(u?.email ?? ''),
        userName: String(u?.fullName ?? ''),
        roleNames,
      });
    });

    if (owner && ownerRole) {
      const ownerId = String(store.owner);
      if (!members.some((m) => m.userId === ownerId)) {
        members.unshift({
          id: `owner-${ownerId}`,
          storeId,
          userId: ownerId,
          roleIds: [String(ownerRole._id)],
          roleNames: [String(ownerRole.name ?? 'Propriétaire')],
          roleId: String(ownerRole._id),
          roleName: String(ownerRole.name ?? 'Propriétaire'),
          status: 'ACTIVE',
          userEmail: String(owner.email ?? ''),
          userName: String(owner.fullName ?? ''),
          createdAt: undefined,
          updatedAt: undefined,
        });
      }
    }

    return members;
  }

  async addStoreMember(
    user: UserModel,
    storeId: string,
    dto: AddStoreMemberDto,
  ) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const email = dto.email.trim().toLowerCase();
    const target = await this.userModel.findOne({ email }).exec();
    if (!target) {
      throw new NotFoundException('user_not_found');
    }
    const store = await this.storeModel.findById(storeId).lean().exec();
    if (!store) throw new NotFoundException('store_not_found');
    if (String(store.owner) === String(target._id)) {
      throw new BadRequestException('owner_already_has_access');
    }

    const roleObjectIds = await this.resolveStoreRoleObjectIds(storeId, dto);
    const roleDocs = await this.storeRoleModel
      .find({ _id: { $in: roleObjectIds } })
      .lean()
      .exec();

    const doc = await this.storeMemberModel
      .findOneAndUpdate(
        { store: storeId, user: target._id },
        {
          $set: {
            roles: roleObjectIds,
            status: 'ACTIVE',
            invitedBy: user._id,
          },
          $unset: { role: 1 },
        },
        { upsert: true, new: true },
      )
      .exec();

    if (target.type === UserTypeEnum.USER) {
      await this.userModel
        .updateOne({ _id: target._id }, { $set: { type: UserTypeEnum.VENDOR } })
        .exec();
    }

    return mapStoreMember(doc!.toObject() as Record<string, unknown>, {
      userEmail: target.email,
      userName: target.fullName,
      roleNames: roleDocs.map((r) => String(r.name ?? '')),
    });
  }

  async updateStoreMember(
    user: UserModel,
    storeId: string,
    memberId: string,
    dto: UpdateStoreMemberDto,
  ) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const roleObjectIds = await this.resolveStoreRoleObjectIds(storeId, dto);
    const roleDocs = await this.storeRoleModel
      .find({ _id: { $in: roleObjectIds } })
      .lean()
      .exec();

    const updated = await this.storeMemberModel
      .findOneAndUpdate(
        { _id: memberId, store: storeId, status: 'ACTIVE' },
        { $set: { roles: roleObjectIds }, $unset: { role: 1 } },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('member_not_found');
    const target = await this.userModel.findById(updated.user).lean().exec();
    return mapStoreMember(updated.toObject() as Record<string, unknown>, {
      userEmail: String(target?.email ?? ''),
      userName: String(target?.fullName ?? ''),
      roleNames: roleDocs.map((r) => String(r.name ?? '')),
    });
  }

  async removeStoreMember(user: UserModel, storeId: string, memberId: string) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
    await this.assertTeamFeatureAvailableForStore(storeId);
    const member = await this.storeMemberModel
      .findOne({ _id: memberId, store: storeId })
      .exec();
    if (!member) throw new NotFoundException('member_not_found');
    const store = await this.storeModel.findById(storeId).lean().exec();
    if (store && String(store.owner) === String(member.user)) {
      throw new ForbiddenException('cannot_remove_owner');
    }
    member.status = 'REVOKED';
    await member.save();
    return { ok: true };
  }

  async listPlatformRoles(user: UserModel) {
    await this.storeAccess.assertAdminPermission(user, 'admin.team.view');
    await this.ensurePlatformRolesSeeded();
    const rows = await this.platformRoleModel
      .find({})
      .sort({ name: 1 })
      .lean()
      .exec();
    return (rows as Record<string, unknown>[]).map(mapPlatformRole);
  }

  async createPlatformRole(user: UserModel, dto: CreatePlatformRoleDto) {
    await this.storeAccess.assertAdminPermission(user, 'admin.team.manage');
    const perms = dto.permissions.filter(isAdminPermission);
    if (!perms.length) throw new BadRequestException('invalid_permissions');
    const doc = await this.platformRoleModel.create({
      name: dto.name.trim(),
      description: (dto.description ?? '').trim(),
      permissions: perms,
      isSystem: false,
      isSuper: false,
    });
    return mapPlatformRole(doc.toObject() as Record<string, unknown>);
  }

  async updatePlatformRole(
    user: UserModel,
    roleId: string,
    dto: UpdatePlatformRoleDto,
  ) {
    await this.storeAccess.assertAdminPermission(user, 'admin.team.manage');
    const role = await this.platformRoleModel.findById(roleId).exec();
    if (!role) throw new NotFoundException('role_not_found');
    if (role.isSystem && role.isSuper) {
      throw new ForbiddenException('cannot_edit_super_role');
    }
    if (dto.name != null) role.name = dto.name.trim();
    if (dto.description != null) role.description = dto.description.trim();
    if (dto.permissions != null) {
      const perms = dto.permissions.filter(isAdminPermission);
      if (!perms.length) throw new BadRequestException('invalid_permissions');
      role.permissions = perms;
    }
    await role.save();
    return mapPlatformRole(role.toObject() as Record<string, unknown>);
  }

  async deletePlatformRole(user: UserModel, roleId: string) {
    await this.storeAccess.assertAdminPermission(user, 'admin.team.manage');
    const role = await this.platformRoleModel.findById(roleId).exec();
    if (!role) throw new NotFoundException('role_not_found');
    if (role.isSystem)
      throw new ForbiddenException('cannot_delete_system_role');
    const inUse = await this.userModel.countDocuments({
      $or: [{ platformRoleId: roleId }, { platformRoleIds: roleId }],
    });
    if (inUse > 0) throw new ConflictException('role_in_use');
    await role.deleteOne();
    return { ok: true };
  }

  async listPlatformMembers(user: UserModel) {
    await this.storeAccess.assertAdminPermission(user, 'admin.team.view');
    const rows = await this.userModel
      .find({ type: UserTypeEnum.ADMIN })
      .select('fullName email platformRoleId platformRoleIds createdAt')
      .sort({ fullName: 1 })
      .lean()
      .exec();
    const roleIds = rows.flatMap((r) =>
      normalizePlatformRoleIds(
        r as {
          platformRoleId?: Types.ObjectId;
          platformRoleIds?: Types.ObjectId[];
        },
      ),
    );
    const roles = await this.platformRoleModel
      .find({ _id: { $in: roleIds } })
      .lean()
      .exec();
    const roleById = new Map(roles.map((r) => [String(r._id), r]));

    return rows.map((u) => {
      const pids = normalizePlatformRoleIds(
        u as {
          platformRoleId?: Types.ObjectId;
          platformRoleIds?: Types.ObjectId[];
        },
      ).map((id) => String(id));
      const roleNames = pids
        .map((id) => roleById.get(id)?.name)
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
      return {
        userId: String(u._id),
        fullName: String(u.fullName ?? ''),
        email: String(u.email ?? ''),
        platformRoleIds: pids,
        platformRoleNames: roleNames,
        platformRoleId: pids[0] ?? null,
        platformRoleName:
          roleNames.length > 0 ? roleNames.join(', ') : 'Super administrateur',
        createdAt: u.createdAt,
      };
    });
  }

  async assignPlatformRole(
    user: UserModel,
    targetUserId: string,
    dto: AssignPlatformRoleDto,
  ) {
    await this.storeAccess.assertAdminPermission(user, 'admin.team.manage');
    const target = await this.userModel.findById(targetUserId).exec();
    if (!target || target.type !== UserTypeEnum.ADMIN) {
      throw new NotFoundException('admin_user_not_found');
    }
    const requestedIds = resolvePlatformRoleIdsFromDto(dto);
    if (String(target._id) === String(user._id) && requestedIds.length > 0) {
      throw new ForbiddenException('cannot_change_own_role');
    }
    if (!requestedIds.length) {
      target.platformRoleId = undefined;
      target.platformRoleIds = [];
    } else {
      const roles = await this.platformRoleModel
        .find({ _id: { $in: requestedIds } })
        .exec();
      if (roles.length !== requestedIds.length) {
        throw new NotFoundException('role_not_found');
      }
      target.platformRoleIds = roles.map((r) => r._id as Types.ObjectId);
      target.platformRoleId = undefined;
    }
    await target.save();
    return { ok: true };
  }

  async getMyStoreContext(user: UserModel) {
    const storeId = await this.resolveVendorStoreId(user);
    return { storeId };
  }
}
