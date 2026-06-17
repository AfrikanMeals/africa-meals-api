import { createHash } from 'node:crypto';

const STRIPE_WEBHOOK_ID_NAMESPACE = 'wise-eat:stripe-webhook';

/**
 * UUID v4-compatible déterministe pour idempotence des webhooks Stripe (EDA-006).
 * Même `stripeEventId` → même `id` domaine → retries Stripe ignorés par le claim.
 */
export function domainEventIdFromStripeWebhook(stripeEventId: string): string {
  const hash = createHash('sha256')
    .update(`${STRIPE_WEBHOOK_ID_NAMESPACE}:${stripeEventId.trim()}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
