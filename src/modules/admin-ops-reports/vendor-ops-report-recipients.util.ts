import {
  collectStoreCcEmails,
  isValidReportEmail,
} from '@modules/admin-ops-reports/vendor-ops-report-cc.util';
import { StoreStatusEnum } from '@schemas/store.schema';
import { Types } from 'mongoose';

export type VendorOpsReportRecipient = {
  ownerId: Types.ObjectId;
  /** E-mail du compte propriétaire (destinataire principal). */
  email: string;
  fullName: string;
  storeIds: Types.ObjectId[];
  storeNames: string[];
  /** E-mails boutique (CC), sans doublon avec l'e-mail propriétaire. */
  ccEmails: string[];
};

/** Document boutique (.lean()) — champs ObjectId souples pour compat TS/Mongoose. */
export type VendorOpsReportStoreLean = {
  _id?: unknown;
  name?: string;
  owner?: unknown;
  email?: string;
};

type UserLean = {
  _id?: Types.ObjectId;
  email?: string;
  fullName?: string;
  type?: string;
};

type OwnerBucket = {
  ownerId: Types.ObjectId;
  email: string;
  fullName: string;
  storeIds: Types.ObjectId[];
  storeNames: string[];
  storeEmails: string[];
};

export function groupStoresIntoVendorRecipients(
  stores: VendorOpsReportStoreLean[],
  usersById: Map<string, UserLean>,
): VendorOpsReportRecipient[] {
  const byOwner = new Map<string, OwnerBucket>();

  for (const store of stores) {
    const ownerId = String(store.owner ?? '').trim();
    if (!ownerId) continue;
    const user = usersById.get(ownerId);
    const email = String(user?.email ?? '')
      .trim()
      .toLowerCase();
    if (!email || !isValidReportEmail(email)) continue;

    const storeId = new Types.ObjectId(String(store._id ?? ''));
    const storeName = String(store.name ?? '').trim() || 'Boutique';
    const storeEmail = String(store.email ?? '').trim();
    const existing = byOwner.get(ownerId);
    if (existing) {
      existing.storeIds.push(storeId);
      existing.storeNames.push(storeName);
      if (storeEmail) existing.storeEmails.push(storeEmail);
      continue;
    }
    byOwner.set(ownerId, {
      ownerId: new Types.ObjectId(ownerId),
      email,
      fullName: String(user?.fullName ?? '').trim() || 'Vendeur',
      storeIds: [storeId],
      storeNames: [storeName],
      storeEmails: storeEmail ? [storeEmail] : [],
    });
  }

  return [...byOwner.values()]
    .map((bucket) => ({
      ownerId: bucket.ownerId,
      email: bucket.email,
      fullName: bucket.fullName,
      storeIds: bucket.storeIds,
      storeNames: bucket.storeNames,
      ccEmails: collectStoreCcEmails(bucket.email, bucket.storeEmails),
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'));
}

export const VENDOR_OPS_REPORT_STORE_STATUSES = [
  StoreStatusEnum.ACTIVE,
  StoreStatusEnum.INACTIVE,
];
