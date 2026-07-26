import { PartnerProfileStatus } from '@schemas/partner-profile.schema';
import {
  canApprovePartnerProfile,
  canManagePartnerProfileStripe,
  canReactivatePartnerProfile,
  canRejectPartnerProfile,
  canRevertPartnerProfileToSubmitted,
  canSuspendPartnerProfile,
  canViewPartnerProfileFinance,
  normalizePartnerProfileAdminStatusFilter,
} from './partner-profile-admin-status.util';

describe('normalizePartnerProfileAdminStatusFilter', () => {
  it('ALL / vide → null (pas de filtre)', () => {
    expect(normalizePartnerProfileAdminStatusFilter('')).toBeNull();
    expect(normalizePartnerProfileAdminStatusFilter('ALL')).toBeNull();
    expect(normalizePartnerProfileAdminStatusFilter(null)).toBeNull();
  });

  it('statuts connus', () => {
    expect(normalizePartnerProfileAdminStatusFilter('draft')).toBe(
      PartnerProfileStatus.DRAFT,
    );
    expect(normalizePartnerProfileAdminStatusFilter('SUBMITTED')).toBe(
      PartnerProfileStatus.SUBMITTED,
    );
    expect(normalizePartnerProfileAdminStatusFilter('APPROVED')).toBe(
      PartnerProfileStatus.APPROVED,
    );
    expect(normalizePartnerProfileAdminStatusFilter('REJECTED')).toBe(
      PartnerProfileStatus.REJECTED,
    );
    expect(normalizePartnerProfileAdminStatusFilter('SUSPENDED')).toBe(
      PartnerProfileStatus.SUSPENDED,
    );
  });

  it('statut inconnu → null (liste complète plutôt qu’erreur)', () => {
    expect(normalizePartnerProfileAdminStatusFilter('PENDING')).toBeNull();
  });
});

describe('transitions admin fiche partenaire', () => {
  it('approve / reject depuis SUBMITTED seulement', () => {
    expect(canApprovePartnerProfile('SUBMITTED')).toBe(true);
    expect(canRejectPartnerProfile('SUBMITTED')).toBe(true);
    expect(canApprovePartnerProfile('APPROVED')).toBe(false);
    expect(canRejectPartnerProfile('DRAFT')).toBe(false);
  });

  it('suspend depuis APPROVED ; réactive depuis SUSPENDED', () => {
    expect(canSuspendPartnerProfile('APPROVED')).toBe(true);
    expect(canSuspendPartnerProfile('SUBMITTED')).toBe(false);
    expect(canReactivatePartnerProfile('SUSPENDED')).toBe(true);
    expect(canReactivatePartnerProfile('APPROVED')).toBe(false);
  });

  it('revert APPROVED → SUBMITTED seulement', () => {
    expect(canRevertPartnerProfileToSubmitted('APPROVED')).toBe(true);
    expect(canRevertPartnerProfileToSubmitted('SUBMITTED')).toBe(false);
    expect(canRevertPartnerProfileToSubmitted('SUSPENDED')).toBe(false);
  });

  it('Stripe manage = APPROVED ; finance/referrers = APPROVED|SUSPENDED', () => {
    expect(canManagePartnerProfileStripe('APPROVED')).toBe(true);
    expect(canManagePartnerProfileStripe('SUSPENDED')).toBe(false);
    expect(canViewPartnerProfileFinance('APPROVED')).toBe(true);
    expect(canViewPartnerProfileFinance('SUSPENDED')).toBe(true);
    expect(canViewPartnerProfileFinance('SUBMITTED')).toBe(false);
  });
});
