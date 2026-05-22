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
    roleName?: string;
  },
) {
  return {
    id: String(doc._id),
    storeId: String(doc.store),
    userId: String(doc.user),
    roleId: String(doc.role),
    status: String(doc.status),
    userEmail: extras?.userEmail ?? '',
    userName: extras?.userName ?? '',
    roleName: extras?.roleName ?? '',
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
    let platformRole: ReturnType<typeof mapPlatformRole> | null = null;
    const roleId = (user as { platformRoleId?: Types.ObjectId })
      .platformRoleId;
    if (user.type === UserTypeEnum.ADMIN && roleId) {
      const role = await this.platformRoleModel.findById(roleId).lean().exec();
      if (role) {
        platformRole = mapPlatformRole(role as Record<string, unknown>);
      }
    }
    return {
      storeAccess,
      adminPermissions,
      platformRole,
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
        role: ownerRole._id,
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

  private async resolveVendorStoreId(user: UserModel): Promise<string> {
    const access = await this.storeAccess.resolveStoreAccess(user);
    const first = access[0];
    if (!first) throw new BadRequestException('no_store');
    return first.storeId;
  }

  async listStoreRoles(user: UserModel, storeId: string) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.view');
    const store = await this.storeModel.findById(storeId).lean().exec();
    if (!store) throw new NotFoundException('store_not_found');
    await this.bootstrapStoreTeam(
      storeId,
      new Types.ObjectId(String(store.owner)),
    );

    const rows = await this.storeRoleModel.find({ store: storeId }).lean().exec();
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
    const role = await this.storeRoleModel
      .findOne({ _id: roleId, store: storeId })
      .exec();
    if (!role) throw new NotFoundException('role_not_found');
    if (role.isOwnerRole || role.isSystem) {
      throw new ForbiddenException('cannot_delete_system_role');
    }
    const inUse = await this.storeMemberModel.countDocuments({
      role: roleId,
      status: 'ACTIVE',
    });
    if (inUse > 0) {
      throw new ConflictException('role_in_use');
    }
    await role.deleteOne();
    return { ok: true };
  }

  async listStoreMembers(user: UserModel, storeId: string) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.view');
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
    const roleIds = rows.map((r) => r.role);
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
      const role = roleById.get(String(r.role));
      return mapStoreMember(r, {
        userEmail: String(u?.email ?? ''),
        userName: String(u?.fullName ?? ''),
        roleName: String(role?.name ?? ''),
      });
    });

    if (owner && ownerRole) {
      const ownerId = String(store.owner);
      if (!members.some((m) => m.userId === ownerId)) {
        members.unshift({
          id: `owner-${ownerId}`,
          storeId,
          userId: ownerId,
          roleId: String(ownerRole._id),
          status: 'ACTIVE',
          userEmail: String(owner.email ?? ''),
          userName: String(owner.fullName ?? ''),
          roleName: String(ownerRole.name ?? 'Propriétaire'),
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

    const role = await this.storeRoleModel
      .findOne({ _id: dto.roleId, store: storeId })
      .exec();
    if (!role) throw new NotFoundException('role_not_found');
    if (role.isOwnerRole) {
      throw new BadRequestException('cannot_assign_owner_role');
    }

    const doc = await this.storeMemberModel
      .findOneAndUpdate(
        { store: storeId, user: target._id },
        {
          $set: {
            role: role._id,
            status: 'ACTIVE',
            invitedBy: user._id,
          },
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
      roleName: role.name,
    });
  }

  async updateStoreMember(
    user: UserModel,
    storeId: string,
    memberId: string,
    dto: UpdateStoreMemberDto,
  ) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
    const role = await this.storeRoleModel
      .findOne({ _id: dto.roleId, store: storeId })
      .exec();
    if (!role) throw new NotFoundException('role_not_found');
    if (role.isOwnerRole) {
      throw new BadRequestException('cannot_assign_owner_role');
    }

    const updated = await this.storeMemberModel
      .findOneAndUpdate(
        { _id: memberId, store: storeId, status: 'ACTIVE' },
        { $set: { role: role._id } },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('member_not_found');
    const target = await this.userModel.findById(updated.user).lean().exec();
    return mapStoreMember(updated.toObject() as Record<string, unknown>, {
      userEmail: String(target?.email ?? ''),
      userName: String(target?.fullName ?? ''),
      roleName: role.name,
    });
  }

  async removeStoreMember(
    user: UserModel,
    storeId: string,
    memberId: string,
  ) {
    await this.storeAccess.assertStorePermission(user, storeId, 'team.manage');
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
    const rows = await this.platformRoleModel.find({}).sort({ name: 1 }).lean().exec();
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
    if (role.isSystem) throw new ForbiddenException('cannot_delete_system_role');
    const inUse = await this.userModel.countDocuments({ platformRoleId: roleId });
    if (inUse > 0) throw new ConflictException('role_in_use');
    await role.deleteOne();
    return { ok: true };
  }

  async listPlatformMembers(user: UserModel) {
    await this.storeAccess.assertAdminPermission(user, 'admin.team.view');
    const rows = await this.userModel
      .find({ type: UserTypeEnum.ADMIN })
      .select('fullName email platformRoleId createdAt')
      .sort({ fullName: 1 })
      .lean()
      .exec();
    const roleIds = rows
      .map((r) => r.platformRoleId)
      .filter(Boolean) as Types.ObjectId[];
    const roles = await this.platformRoleModel
      .find({ _id: { $in: roleIds } })
      .lean()
      .exec();
    const roleById = new Map(roles.map((r) => [String(r._id), r]));

    return rows.map((u) => {
      const rid = u.platformRoleId ? String(u.platformRoleId) : '';
      const role = rid ? roleById.get(rid) : null;
      return {
        userId: String(u._id),
        fullName: String(u.fullName ?? ''),
        email: String(u.email ?? ''),
        platformRoleId: rid || null,
        platformRoleName: role?.name ?? 'Super administrateur',
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
    if (String(target._id) === String(user._id) && dto.platformRoleId) {
      throw new ForbiddenException('cannot_change_own_role');
    }
    const roleId = dto.platformRoleId?.trim();
    if (!roleId) {
      target.platformRoleId = undefined;
    } else {
      const role = await this.platformRoleModel.findById(roleId).exec();
      if (!role) throw new NotFoundException('role_not_found');
      (target as UserModel & { platformRoleId?: Types.ObjectId }).platformRoleId =
        role._id as Types.ObjectId;
    }
    await target.save();
    return { ok: true };
  }

  async getMyStoreContext(user: UserModel) {
    const storeId = await this.resolveVendorStoreId(user);
    return { storeId };
  }
}
