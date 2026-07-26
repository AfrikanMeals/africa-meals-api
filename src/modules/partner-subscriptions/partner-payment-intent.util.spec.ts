import {
  isPartnerSubscriptionPaymentIntentKind,
  PARTNER_SUBSCRIPTION_STRIPE_KIND,
} from './partner-payment-intent.util';

describe('partner-payment-intent.util', () => {
  it('accepte le kind canonique', () => {
    expect(
      isPartnerSubscriptionPaymentIntentKind(PARTNER_SUBSCRIPTION_STRIPE_KIND),
    ).toBe(true);
  });

  it('refuse un kind vendeur / vide', () => {
    expect(isPartnerSubscriptionPaymentIntentKind('vendor_subscription')).toBe(
      false,
    );
    expect(isPartnerSubscriptionPaymentIntentKind('')).toBe(false);
    expect(isPartnerSubscriptionPaymentIntentKind(null)).toBe(false);
  });
});
