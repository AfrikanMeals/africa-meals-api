import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

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
export type StripeOnboardingStatusLabel =
  | 'COMPLETE'
  | 'ACTION_REQUIRED'
  | 'IN_PROGRESS'
  | 'NOT_STARTED';

/** Statut onboarding Stripe Connect pour affichage admin. */
export function resolveStripeOnboardingStatusLabel(
  user: StripeOnboardingCachedUser | Record<string, unknown> | null | undefined,
): StripeOnboardingStatusLabel {
  if (!user) return 'NOT_STARTED';
  const accountId = String(
    (user as Record<string, unknown>).stripeConnectAccountId ?? '',
  ).trim();
  if (!accountId) return 'NOT_STARTED';

  const chargesEnabled = Boolean(
    (user as Record<string, unknown>).stripeConnectChargesEnabled,
  );
  const payoutsEnabled = Boolean(
    (user as Record<string, unknown>).stripeConnectPayoutsEnabled,
  );
  const detailsSubmitted = Boolean(
    (user as Record<string, unknown>).stripeConnectDetailsSubmitted,
  );
  const disabledReason = String(
    (user as Record<string, unknown>).stripeConnectDisabledReason ?? '',
  ).trim();
  const currentlyDue = Array.isArray(
    (user as Record<string, unknown>).stripeConnectRequirementsDue,
  )
    ? ((user as Record<string, unknown>).stripeConnectRequirementsDue as string[])
    : [];
  const pastDue = Array.isArray(
    (user as Record<string, unknown>).stripeConnectRequirementsPastDue,
  )
    ? ((user as Record<string, unknown>)
        .stripeConnectRequirementsPastDue as string[])
    : [];

  if (disabledReason || pastDue.length > 0) return 'ACTION_REQUIRED';
  if (
    chargesEnabled &&
    payoutsEnabled &&
    detailsSubmitted &&
    currentlyDue.length === 0
  ) {
    return 'COMPLETE';
  }
  if (accountId || detailsSubmitted) return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

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

/**
 * Agrégation `stores` : ACTIVE + accepte commandes + vendeur Stripe Connect opérationnel.
 * Optionnellement limité à une liste d’ids (pubs, boissons multi-boutiques, etc.).
 */
export function pipelineActiveStoresWithStripeOnboarded(
  storeIds?: Types.ObjectId[],
): PipelineStage[] {
  const match: Record<string, unknown> = {
    status: StoreStatusEnum.ACTIVE,
    acceptsOrders: { $ne: false },
  };
  if (storeIds?.length) {
    match._id = { $in: storeIds };
  }
  return [{ $match: match }, ...storeOwnerStripeOnboardedPipelineStages()];
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
/** Retourne les ids boutique visibles côté app client (paiements Stripe OK). */
export async function resolveStoreIdsVisibleOnMobileApp(
  storeModel: Model<StoreModel>,
  storeIds: Types.ObjectId[],
): Promise<Set<string>> {
  if (!storeIds.length) return new Set();
  const rows = await storeModel
    .aggregate([
      ...pipelineActiveStoresWithStripeOnboarded(storeIds),
      { $project: { _id: 1 } },
    ])
    .exec();
  return new Set(rows.map((r) => String(r._id)));
}

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
