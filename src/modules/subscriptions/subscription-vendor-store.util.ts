import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UserModel } from '@schemas/user.schema';

export function vendorStoreObjectIds(user: UserModel): Types.ObjectId[] {
  const rawStores = user.stores || [];
  const ids: Types.ObjectId[] = [];
  for (const s of rawStores) {
    if (typeof s === 'object' && s !== null && '_id' in s) {
      const id = (s as { _id: unknown })._id;
      ids.push(
        id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id)),
      );
    } else if (s) {
      ids.push(new Types.ObjectId(String(s)));
    }
  }
  return ids;
}

/** Résout la boutique cible pour souscription / paiement vendeur. */
export function resolveVendorCheckoutStoreId(
  user: UserModel,
  explicitStoreId: string | undefined,
  planStoreId: unknown,
): Types.ObjectId {
  const storeIds = vendorStoreObjectIds(user);
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
