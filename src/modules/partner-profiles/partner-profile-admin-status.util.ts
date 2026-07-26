import { PartnerProfileStatus } from '@schemas/partner-profile.schema';

const STATUS_SET = new Set<string>(Object.values(PartnerProfileStatus));

/**
 * Filtre statut admin fiches partenaire.
 * `ALL` / vide → pas de filtre Mongo ; sinon un statut connu.
 */
export function normalizePartnerProfileAdminStatusFilter(
  raw?: string | null,
): PartnerProfileStatus | null {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!s || s === 'ALL') return null;
  if (STATUS_SET.has(s)) return s as PartnerProfileStatus;
  return null;
}

/** Transitions admin — source de vérité UI + service. */
export function canApprovePartnerProfile(status: string): boolean {
  return String(status).toUpperCase() === PartnerProfileStatus.SUBMITTED;
}

export function canRejectPartnerProfile(status: string): boolean {
  return String(status).toUpperCase() === PartnerProfileStatus.SUBMITTED;
}

export function canSuspendPartnerProfile(status: string): boolean {
  return String(status).toUpperCase() === PartnerProfileStatus.APPROVED;
}

export function canReactivatePartnerProfile(status: string): boolean {
  return String(status).toUpperCase() === PartnerProfileStatus.SUSPENDED;
}

/** Annuler une approbation par erreur → remettre en file Soumises. */
export function canRevertPartnerProfileToSubmitted(status: string): boolean {
  return String(status).toUpperCase() === PartnerProfileStatus.APPROVED;
}
