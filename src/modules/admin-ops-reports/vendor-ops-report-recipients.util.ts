import { StoreStatusEnum } from '@schemas/store.schema';
import { Types } from 'mongoose';

export type VendorOpsReportRecipient = {
  ownerId: Types.ObjectId;
  email: string;
  fullName: string;
  storeIds: Types.ObjectId[];
  storeNames: string[];
};

type StoreLean = {
  _id?: Types.ObjectId;
  name?: string;
  owner?: Types.ObjectId;
};

type UserLean = {
  _id?: Types.ObjectId;
  email?: string;
  fullName?: string;
  type?: string;
};

export function groupStoresIntoVendorRecipients(
  stores: StoreLean[],
  usersById: Map<string, UserLean>,
): VendorOpsReportRecipient[] {
  const byOwner = new Map<string, VendorOpsReportRecipient>();

  for (const store of stores) {
    const ownerId = String(store.owner ?? '').trim();
    if (!ownerId) continue;
    const user = usersById.get(ownerId);
    const email = String(user?.email ?? '')
      .trim()
      .toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;

    const storeId = store._id as Types.ObjectId;
    const storeName = String(store.name ?? '').trim() || 'Boutique';
    const existing = byOwner.get(ownerId);
    if (existing) {
      existing.storeIds.push(storeId);
      existing.storeNames.push(storeName);
      continue;
    }
    byOwner.set(ownerId, {
      ownerId: new Types.ObjectId(ownerId),
      email,
      fullName: String(user?.fullName ?? '').trim() || 'Vendeur',
      storeIds: [storeId],
      storeNames: [storeName],
    });
  }

  return [...byOwner.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'fr'),
  );
}

export const VENDOR_OPS_REPORT_STORE_STATUSES = [
  StoreStatusEnum.ACTIVE,
  StoreStatusEnum.INACTIVE,
];
