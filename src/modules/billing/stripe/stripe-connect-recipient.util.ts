import { UserTypeEnum } from '@schemas/user.schema';

/**
 * Types autorisés à détenir un compte Stripe Connect Express (user-scoped).
 * PARTNER : finance affiliation (miroir livreur / vendeur).
 */
export function isStripeConnectRecipientType(
  type: string | null | undefined,
): boolean {
  const t = String(type ?? '')
    .trim()
    .toUpperCase();
  return (
    t === UserTypeEnum.VENDOR ||
    t === UserTypeEnum.DELIVERY ||
    t === UserTypeEnum.PARTNER
  );
}
