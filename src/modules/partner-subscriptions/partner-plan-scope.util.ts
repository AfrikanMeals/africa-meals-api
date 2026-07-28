import { Types } from 'mongoose';

/**
 * Filtre catalogue Partner self-service :
 * - plans globaux (`partnerUserId` absent / null)
 * - + plans custom du partenaire courant
 */
export function partnerPlanVisibleToUser(args: {
  partnerUserId?: Types.ObjectId | string | null;
  viewerUserId: string;
}): boolean {
  const scoped = args.partnerUserId
    ? String(args.partnerUserId).trim()
    : '';
  if (!scoped) return true;
  return scoped === String(args.viewerUserId ?? '').trim();
}

/** Clause Mongo : globaux OU custom du partner. */
export function partnerActivePlansMongoFilter(
  viewerUserId: string,
): Record<string, unknown> {
  const oid = Types.ObjectId.isValid(viewerUserId)
    ? new Types.ObjectId(viewerUserId)
    : null;
  return {
    active: true,
    $or: [
      { partnerUserId: { $exists: false } },
      { partnerUserId: null },
      ...(oid ? [{ partnerUserId: oid }] : []),
    ],
  };
}

export function isCustomPartnerPlan(
  partnerUserId?: Types.ObjectId | string | null,
): boolean {
  return Boolean(partnerUserId && String(partnerUserId).trim());
}
