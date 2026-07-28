import { isEligibleForPartnerApplication } from '@modules/partner-applications/partner-application-eligibility.util';
import { UserTypeEnum } from '@schemas/user.schema';

/**
 * Approve fiche : les candidats (USER / VENDOR / DELIVERY) doivent passer
 * type PARTNER — l’UI Collaborations « Candidatures » a été retirée ;
 * Approuver la fiche est désormais le passage mode Partner.
 * PARTNER déjà actif / ADMIN : pas de promotion.
 */
export function shouldPromoteUserTypeOnPartnerProfileApprove(
  userType: string | null | undefined,
): boolean {
  return isEligibleForPartnerApplication(userType);
}

/**
 * Type d’origine à mémoriser sur la fiche (restore suspend).
 * Aligné `resolvePartnerSuspendRestoreType`.
 */
export function resolvePreviousUserTypeForPartnerProfileApprove(
  userType: string | null | undefined,
): string {
  const t = String(userType ?? '')
    .trim()
    .toUpperCase();
  if (t === UserTypeEnum.VENDOR) return UserTypeEnum.VENDOR;
  if (t === UserTypeEnum.DELIVERY) return UserTypeEnum.DELIVERY;
  return UserTypeEnum.USER;
}
