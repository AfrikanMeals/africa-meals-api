import {
  buildMobileStripeCheckoutCancelUrl,
  buildMobileStripeCheckoutSuccessUrl,
  isMobileCheckoutClient,
  mobileStripeCheckoutReturnHtml,
  parseMobileStripeReturnKind,
} from './mobile-stripe-checkout-return.util';

describe('mobile-stripe-checkout-return.util', () => {
  it('détecte client=mobile', () => {
    expect(isMobileCheckoutClient('mobile')).toBe(true);
    expect(isMobileCheckoutClient('Mobile')).toBe(true);
    expect(isMobileCheckoutClient('admin')).toBe(false);
    expect(isMobileCheckoutClient(undefined)).toBe(false);
  });

  it('success_url contient kind=ad_credit seulement pour mobile', () => {
    const url = buildMobileStripeCheckoutSuccessUrl({
      serverUrl: 'https://api.example.com',
      kind: 'ad_credit',
    });
    expect(url).toContain('/api/billing/stripe/mobile-return');
    expect(url).toContain('kind=ad_credit');
    expect(url).toContain('session_id={CHECKOUT_SESSION_ID}');
  });

  it('success_url sms_billing', () => {
    const url = buildMobileStripeCheckoutSuccessUrl({
      serverUrl: 'https://api.example.com/',
      kind: 'sms_billing',
    });
    expect(url).toContain('kind=sms_billing');
  });

  it('cancel_url pointe payment-cancel', () => {
    expect(buildMobileStripeCheckoutCancelUrl('https://api.example.com')).toBe(
      'https://api.example.com/api/billing/stripe/payment-cancel',
    );
  });

  it('HTML pont expose le deep link wise-eat', () => {
    const html = mobileStripeCheckoutReturnHtml({
      sessionId: 'cs_test_1',
      kind: 'ad_credit',
    });
    expect(html).toContain(
      'wise-eat://stripe-return?kind=ad_credit&session_id=cs_test_1',
    );
  });

  it('parseMobileStripeReturnKind', () => {
    expect(parseMobileStripeReturnKind('ad_credit')).toBe('ad_credit');
    expect(parseMobileStripeReturnKind('sms_billing')).toBe('sms_billing');
    expect(parseMobileStripeReturnKind('nope')).toBeNull();
  });
});
