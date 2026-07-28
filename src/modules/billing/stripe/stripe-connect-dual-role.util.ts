import { UserTypeEnum } from '@schemas/user.schema';
import { isStripeConnectRecipientType } from './stripe-connect-recipient.util';

/**
 * Accès aux routes `delivery-agent/payments/*` (Connect user-scoped).
 *
 * Invariant : un user = un `stripeConnectAccountId` partagé Partner / Livreur /
 * Vendeur. Après approve Collaborations, `type` → PARTNER mais la candidature
 * livreur reste APPROVED — le mode courier doit encore lire le même Connect.
 */
export function canAccessDeliveryConnectPayments(params: {
  userType: string | null | undefined;
  deliveryApplicationStatus?: string | null;
}): boolean {
  const t = String(params.userType ?? '')
    .trim()
    .toUpperCase();
  if (t === UserTypeEnum.DELIVERY) return true;
  // Dual-role : type écrasé (PARTNER / VENDOR / USER) + candidature APPROVED.
  const app = String(params.deliveryApplicationStatus ?? '')
    .trim()
    .toUpperCase();
  if (app !== 'APPROVED') return false;
  return (
    t === UserTypeEnum.PARTNER ||
    t === UserTypeEnum.VENDOR ||
    t === UserTypeEnum.USER ||
    t === 'CUSTOMER'
  );
}

/**
 * Settle payout après transfer livraison : tout destinataire Connect
 * (pas seulement `type === DELIVERY` — dual-role PARTNER).
 */
export function canSettleDeliveryConnectPayout(
  userType: string | null | undefined,
): boolean {
  return isStripeConnectRecipientType(userType);
}
