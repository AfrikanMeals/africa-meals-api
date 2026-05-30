import {
  isStorePermission,
  StorePermission,
} from '../../common/permissions/store-permissions';
import { Types } from 'mongoose';

export function normalizeStoreMemberRoleIds(doc: {
  role?: Types.ObjectId;
  roles?: Types.ObjectId[];
}): Types.ObjectId[] {
  if (Array.isArray(doc.roles) && doc.roles.length > 0) {
    return doc.roles.filter((id) => Types.ObjectId.isValid(String(id)));
  }
  if (doc.role && Types.ObjectId.isValid(String(doc.role))) {
    return [doc.role as Types.ObjectId];
  }
  return [];
}

export function normalizePlatformRoleIds(user: {
  platformRoleId?: Types.ObjectId;
  platformRoleIds?: Types.ObjectId[];
}): Types.ObjectId[] {
  if (Array.isArray(user.platformRoleIds) && user.platformRoleIds.length > 0) {
    return user.platformRoleIds.filter((id) =>
      Types.ObjectId.isValid(String(id)),
    );
  }
  if (
    user.platformRoleId &&
    Types.ObjectId.isValid(String(user.platformRoleId))
  ) {
    return [user.platformRoleId];
  }
  return [];
}

export function unionStorePermissionsFromRoles(
  roleDocs: Array<{ permissions?: string[] }>,
): StorePermission[] {
  const set = new Set<StorePermission>();
  for (const role of roleDocs) {
    for (const p of role.permissions ?? []) {
      if (isStorePermission(p)) set.add(p);
    }
  }
  return [...set];
}

export function resolveRoleIdsFromDto(dto: {
  roleId?: string;
  roleIds?: string[];
}): string[] {
  const fromArray = (dto.roleIds ?? [])
    .map((id) => id?.trim())
    .filter((id) => id && Types.ObjectId.isValid(id));
  if (fromArray.length) return [...new Set(fromArray)];
  const single = dto.roleId?.trim();
  if (single && Types.ObjectId.isValid(single)) return [single];
  return [];
}

export function resolvePlatformRoleIdsFromDto(dto: {
  platformRoleId?: string | null;
  platformRoleIds?: string[] | null;
}): string[] {
  if (dto.platformRoleIds === null) return [];
  const fromArray = (dto.platformRoleIds ?? [])
    .map((id) => id?.trim())
    .filter((id) => id && Types.ObjectId.isValid(id));
  if (fromArray.length) return [...new Set(fromArray)];
  const single = dto.platformRoleId?.trim();
  if (single && Types.ObjectId.isValid(single)) return [single];
  return [];
}
