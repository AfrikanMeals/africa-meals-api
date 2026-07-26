/** Métadonnées Stripe PaymentIntent / Checkout — kind Partner. */
export const PARTNER_SUBSCRIPTION_STRIPE_KIND = 'partner_subscription';

/** True si le PaymentIntent appartient au flux abonnement Partner. */
export function isPartnerSubscriptionPaymentIntentKind(
  kind: string | null | undefined,
): boolean {
  return String(kind ?? '').trim() === PARTNER_SUBSCRIPTION_STRIPE_KIND;
}
