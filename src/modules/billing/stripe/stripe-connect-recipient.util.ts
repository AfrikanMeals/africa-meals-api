import { UserTypeEnum } from '@schemas/user.schema';

/**
 * Types autorisés à détenir un compte Stripe Connect Express (user-scoped).
 *
 * Invariant plateforme : **un user = un** `stripeConnectAccountId` partagé entre
 * modes Partner / Livreur / Vendeur (pas de compte Connect par rôle).
 * PARTNER : finance affiliation ; mêmes flags Connect que vendeur/livreur.
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
