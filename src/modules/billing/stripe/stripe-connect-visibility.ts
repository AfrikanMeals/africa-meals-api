import { FilterQuery, PipelineStage } from 'mongoose';
import { UserModel } from '@schemas/user.schema';

/** Champs vendeur mis en cache par {@link StripeConnectService.syncAccountFlags}. */
export type StripeOnboardingCachedUser = {
  stripeConnectAccountId?: string | null;
  stripeConnectChargesEnabled?: boolean;
  stripeConnectPayoutsEnabled?: boolean;
  stripeConnectDetailsSubmitted?: boolean;
  stripeConnectDisabledReason?: string | null;
  stripeConnectRequirementsDue?: string[] | null;
  stripeConnectRequirementsPastDue?: string[] | null;
};

/** Aligné sur `isConnectFullyActive` (stripe-connect.service). */
export function isStripeConnectOnboardingCompleteUser(
  user: StripeOnboardingCachedUser | null | undefined,
): boolean {
  if (!user) return false;
  const accountId = String(user.stripeConnectAccountId ?? '').trim();
  if (!accountId) return false;
  if (!user.stripeConnectChargesEnabled) return false;
  if (!user.stripeConnectPayoutsEnabled) return false;
  if (!user.stripeConnectDetailsSubmitted) return false;
  const disabled = String(user.stripeConnectDisabledReason ?? '').trim();
  if (disabled) return false;
  const due = user.stripeConnectRequirementsDue ?? [];
  const past = user.stripeConnectRequirementsPastDue ?? [];
  if (due.length > 0 || past.length > 0) return false;
  return true;
}

/** Filtre Mongo sur la collection `users` (propriétaire boutique). */
export function mongoFilterStripeOnboardingCompleteOwner(): FilterQuery<UserModel> {
  return {
    stripeConnectAccountId: { $exists: true, $nin: [null, ''] },
    stripeConnectChargesEnabled: true,
    stripeConnectPayoutsEnabled: true,
    stripeConnectDetailsSubmitted: true,
    $or: [
      { stripeConnectDisabledReason: { $exists: false } },
      { stripeConnectDisabledReason: null },
      { stripeConnectDisabledReason: '' },
    ],
    $and: [
      {
        $or: [
          { stripeConnectRequirementsDue: { $exists: false } },
          { stripeConnectRequirementsDue: { $size: 0 } },
        ],
      },
      {
        $or: [
          { stripeConnectRequirementsPastDue: { $exists: false } },
          { stripeConnectRequirementsPastDue: { $size: 0 } },
        ],
      },
    ],
  };
}

const OWNER_LOOKUP = '_ownerStripeOnboarded';

/**
 * À enchaîner sur un pipeline dont les documents sont des boutiques (`stores`).
 */
export function storeOwnerStripeOnboardedPipelineStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'users',
        localField: 'owner',
        foreignField: '_id',
        as: OWNER_LOOKUP,
        pipeline: [
          { $match: mongoFilterStripeOnboardingCompleteOwner() },
          { $project: { _id: 1 } },
        ],
      },
    },
    { $match: { [`${OWNER_LOOKUP}.0`]: { $exists: true } } },
    { $project: { [OWNER_LOOKUP]: 0 } },
  ];
}

/**
 * Après `$lookup` store sur un produit (`store` objet avec champ `owner`).
 */
export function productEmbeddedStoreOwnerStripeOnboardedStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'users',
        localField: 'store.owner',
        foreignField: '_id',
        as: OWNER_LOOKUP,
        pipeline: [
          { $match: mongoFilterStripeOnboardingCompleteOwner() },
          { $project: { _id: 1 } },
        ],
      },
    },
    { $match: { [`${OWNER_LOOKUP}.0`]: { $exists: true } } },
    { $project: { [OWNER_LOOKUP]: 0 } },
  ];
}
