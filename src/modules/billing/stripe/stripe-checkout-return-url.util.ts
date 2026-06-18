import { ConfigService } from '@nestjs/config';

function appendCheckoutSessionIdPlaceholder(url: string): string {
  const raw = url.trim();
  if (!raw) return raw;
  if (raw.includes('{CHECKOUT_SESSION_ID}')) return raw;
  return `${raw}${raw.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
}

/** Ajoute `mobile_return=order` sur la page web checkout-success (pont → app mobile). */
function appendMobileOrderReturn(url: string): string {
  const raw = url.trim();
  if (!raw) return raw;
  if (raw.includes('mobile_return=')) return raw;
  if (!raw.includes('/checkout-success')) return raw;
  return `${raw}${raw.includes('?') ? '&' : '?'}mobile_return=order`;
}

/** URL de retour Stripe Checkout commandes (SSE-007). */
export function resolveStripeCheckoutSuccessUrl(config: ConfigService): string {
  const server =
    config.get<string>('SERVER_URL')?.replace(/\/$/, '') ?? 'http://localhost:9000';
  const publicWeb = config
    .get<string>('PUBLIC_WEB_URL')
    ?.trim()
    .replace(/\/$/, '');
  const configured =
    config.get<string>('STRIPE_CHECKOUT_SUCCESS_URL')?.trim() || '';
  const base =
    configured ||
    (publicWeb
      ? `${publicWeb}/checkout-success`
      : `${server}/api/billing/stripe/payment-done`);
  return appendMobileOrderReturn(appendCheckoutSessionIdPlaceholder(base));
}
