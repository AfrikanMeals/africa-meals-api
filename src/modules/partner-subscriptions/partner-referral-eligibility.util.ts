/**
 * Un code referral est utilisable si le titulaire est encore PARTNER
 * et que la candidature n’est pas suspendue.
 *
 * Fix: le lookup exigeait `status === APPROVED` alors que ensure-referral /
 * Partner signup peuvent poser un code sur une ligne DRAFT / AWAITING_REVIEW
 * — le chip header affichait le code, la landing le refusait (ex. BORISS).
 */
export function isPartnerReferralCodeEligible(args: {
  partnerUserType?: string | null;
  applicationStatus?: string | null;
}): boolean {
  const type = String(args.partnerUserType ?? '')
    .trim()
    .toUpperCase();
  if (type !== 'PARTNER') return false;
  const status = String(args.applicationStatus ?? '')
    .trim()
    .toUpperCase();
  if (status === 'SUSPENDED') return false;
  return true;
}
