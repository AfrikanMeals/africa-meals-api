/** Metadata Stripe PaymentIntent — règlement Ad Credit (Payment Sheet mobile). */
export const AD_CREDIT_PAYMENT_INTENT_KIND = 'ad_credit_payment';

/** Metadata Stripe PaymentIntent — même kind que Checkout SMS (webhook / sync). */
export const VENDOR_SMS_BILLING_PAYMENT_INTENT_KIND =
  'vendor_sms_notification_billing';

/** True si le PI est un règlement Ad Credit. */
export function isAdCreditPaymentIntentKind(
  kind: string | null | undefined,
): boolean {
  return String(kind ?? '').trim() === AD_CREDIT_PAYMENT_INTENT_KIND;
}

/** True si le PI est une facture SMS vendeur. */
export function isVendorSmsBillingPaymentIntentKind(
  kind: string | null | undefined,
): boolean {
  return String(kind ?? '').trim() === VENDOR_SMS_BILLING_PAYMENT_INTENT_KIND;
}

/**
 * Clé unique `stripeCheckoutSessionId` pour un PI mobile (schéma Ad Credit
 * exige encore ce champ unique — préfixe évite collision avec `cs_…`).
 */
export function adCreditPaymentKeyFromPaymentIntentId(
  paymentIntentId: string,
): string {
  const id = String(paymentIntentId ?? '').trim();
  if (!id) return '';
  // Déjà préfixé (re-sync) → inchangé.
  if (id.startsWith('pi_mobile_')) return id;
  return `pi_mobile_${id}`;
}
