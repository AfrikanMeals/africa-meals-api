import { UserTypeEnum } from '@schemas/user.schema';

/**
 * Éligibilité candidature partenaire plateforme.
 * Aligné mobile `canApplyToBecomePartner` : USER / VENDOR / DELIVERY ; pas ADMIN ni PARTNER.
 */
export function isEligibleForPartnerApplication(
  userType: string | null | undefined,
): boolean {
  const t = String(userType ?? '')
    .trim()
    .toUpperCase();
  if (!t || t === UserTypeEnum.ADMIN || t === UserTypeEnum.PARTNER) {
    return false;
  }
  return (
    t === UserTypeEnum.USER ||
    t === UserTypeEnum.VENDOR ||
    t === UserTypeEnum.DELIVERY
  );
}

/** Type à restaurer après suspension (défaut USER si inconnu). */
export function resolvePartnerSuspendRestoreType(
  previousUserType: string | null | undefined,
): UserTypeEnum {
  const t = String(previousUserType ?? '')
    .trim()
    .toUpperCase();
  if (t === UserTypeEnum.VENDOR) return UserTypeEnum.VENDOR;
  if (t === UserTypeEnum.DELIVERY) return UserTypeEnum.DELIVERY;
  return UserTypeEnum.USER;
}
