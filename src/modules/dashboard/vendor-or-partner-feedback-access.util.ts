import { UserTypeEnum } from '@schemas/user.schema';

/**
 * App Reviews (POST /dashboard/vendor-feedback) : VENDOR historique + PARTNER
 * (sidebar Paramètres partenaire web/mobile).
 */
export function canSubmitVendorOrPartnerFeedback(
  type: UserTypeEnum | string | null | undefined,
): boolean {
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  return t === UserTypeEnum.VENDOR || t === UserTypeEnum.PARTNER;
}
