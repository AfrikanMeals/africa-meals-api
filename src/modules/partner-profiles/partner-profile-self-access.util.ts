import { UserTypeEnum } from '@schemas/user.schema';
import { isEligibleForPartnerApplication } from '@modules/partner-applications/partner-application-eligibility.util';

/**
 * Accès self-service fiche partenaire.
 * PARTNER (historique) + candidats éligibles (USER/VENDOR/DELIVERY)
 * — remplace le formulaire « Devenir partenaire ».
 */
export function canAccessPartnerProfileSelf(
  userType: string | null | undefined,
): boolean {
  const t = String(userType ?? '')
    .trim()
    .toUpperCase();
  if (t === UserTypeEnum.PARTNER) return true;
  return isEligibleForPartnerApplication(t);
}
