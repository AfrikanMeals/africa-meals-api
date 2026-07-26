/**
 * Projection admin liste abonnements Partner — pure pour tests.
 * Enrichit le mapping de base avec identité owner.
 */

export type PartnerSubscriptionAdminListRow = {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  planName: string;
  status: string;
  billingPeriod: string;
  isTrial: boolean;
  isOffer: boolean;
};

/** Fusionne mapSub + profil owner pour la table admin. */
export function mergePartnerSubscriptionAdminRow(args: {
  mapped: {
    id: string;
    ownerId: string;
    planName: string;
    status: string;
    billingPeriod: string;
    isTrial: boolean;
    isOffer: boolean;
  };
  ownerName?: string;
  ownerEmail?: string;
}): PartnerSubscriptionAdminListRow {
  return {
    id: args.mapped.id,
    ownerId: args.mapped.ownerId,
    ownerName: String(args.ownerName ?? '').trim(),
    ownerEmail: String(args.ownerEmail ?? '').trim(),
    planName: args.mapped.planName,
    status: args.mapped.status,
    billingPeriod: args.mapped.billingPeriod,
    isTrial: args.mapped.isTrial === true,
    isOffer: args.mapped.isOffer === true,
  };
}
