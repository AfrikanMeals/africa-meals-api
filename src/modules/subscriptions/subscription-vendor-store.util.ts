import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserModel } from '@schemas/user.schema';

export function vendorStoreObjectIds(user: UserModel): Types.ObjectId[] {
  const rawStores = user.stores || [];
  const ids: Types.ObjectId[] = [];
  const seen = new Set<string>();
  for (const s of rawStores) {
    let oid: Types.ObjectId | null = null;
    if (typeof s === 'object' && s !== null && '_id' in s) {
      const id = (s as { _id: unknown })._id;
      oid =
        id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
    } else if (s) {
      const raw = String(s);
      if (Types.ObjectId.isValid(raw)) oid = new Types.ObjectId(raw);
    }
    if (!oid) continue;
    const key = String(oid);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(oid);
  }
  return ids;
}

export function mergeVendorStoreObjectIds(
  ...lists: Types.ObjectId[][]
): Types.ObjectId[] {
  const seen = new Set<string>();
  const out: Types.ObjectId[] = [];
  for (const list of lists) {
    for (const id of list) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id instanceof Types.ObjectId ? id : new Types.ObjectId(key));
    }
  }
  return out;
}

/** Résout la boutique cible pour souscription / paiement vendeur. */
export function resolveVendorCheckoutStoreId(
  user: UserModel,
  explicitStoreId: string | undefined,
  planStoreId: unknown,
  extraStoreIds: Types.ObjectId[] = [],
): Types.ObjectId {
  const storeIds = mergeVendorStoreObjectIds(
    vendorStoreObjectIds(user),
    extraStoreIds,
  );
  if (!storeIds.length) {
    throw new BadRequestException('no_store');
  }
  const planStore = planStoreId ? String(planStoreId) : '';
  if (planStore) {
    const owns = storeIds.some((id) => String(id) === planStore);
    if (!owns) throw new ForbiddenException('plan_not_for_store');
    if (explicitStoreId && explicitStoreId !== planStore) {
      throw new BadRequestException('store_plan_mismatch');
    }
    return new Types.ObjectId(planStore);
  }
  if (explicitStoreId) {
    if (!Types.ObjectId.isValid(explicitStoreId)) {
      throw new BadRequestException('invalid_store');
    }
    const owns = storeIds.some((id) => String(id) === explicitStoreId);
    if (!owns) throw new ForbiddenException('store_not_owned');
    return new Types.ObjectId(explicitStoreId);
  }
  return storeIds[0];
}
