import {
  AD_CREDIT_PAYMENT_INTENT_KIND,
  VENDOR_SMS_BILLING_PAYMENT_INTENT_KIND,
  adCreditPaymentKeyFromPaymentIntentId,
  isAdCreditPaymentIntentKind,
  isVendorSmsBillingPaymentIntentKind,
} from './vendor-billing-payment-intent.util';

describe('vendor-billing-payment-intent.util', () => {
  it('reconnaît les kinds PaymentIntent', () => {
    expect(isAdCreditPaymentIntentKind(AD_CREDIT_PAYMENT_INTENT_KIND)).toBe(
      true,
    );
    expect(isAdCreditPaymentIntentKind('other')).toBe(false);
    expect(
      isVendorSmsBillingPaymentIntentKind(VENDOR_SMS_BILLING_PAYMENT_INTENT_KIND),
    ).toBe(true);
    expect(isVendorSmsBillingPaymentIntentKind('ad_credit_payment')).toBe(
      false,
    );
  });

  it('clé Ad Credit unique depuis pi_…', () => {
    expect(adCreditPaymentKeyFromPaymentIntentId('pi_abc')).toBe(
      'pi_mobile_pi_abc',
    );
    expect(adCreditPaymentKeyFromPaymentIntentId('pi_mobile_pi_abc')).toBe(
      'pi_mobile_pi_abc',
    );
    expect(adCreditPaymentKeyFromPaymentIntentId('')).toBe('');
  });
});
