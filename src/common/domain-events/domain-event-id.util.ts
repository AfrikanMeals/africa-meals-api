import { createHash } from 'node:crypto';

const STRIPE_WEBHOOK_ID_NAMESPACE = 'wise-eat:stripe-webhook';
const TRIAL_REMINDER_ID_NAMESPACE = 'wise-eat:subscription-trial-reminder';
const COURIER_TRACKING_ID_NAMESPACE = 'wise-eat:courier-tracking';

function uuidV4FromSha256(namespace: string, key: string): string {
  const hash = createHash('sha256')
    .update(`${namespace}:${key.trim()}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * UUID v4-compatible déterministe pour idempotence des webhooks Stripe (EDA-006).
 * Même `stripeEventId` → même `id` domaine → retries Stripe ignorés par le claim.
 */
export function domainEventIdFromStripeWebhook(stripeEventId: string): string {
  return uuidV4FromSha256(STRIPE_WEBHOOK_ID_NAMESPACE, stripeEventId);
}

/**
 * UUID déterministe pour rappels trial planifiés (EDA-009).
 * Même abonnement + même jour restant → un seul event / handler.
 */
export function domainEventIdFromTrialReminder(
  subscriptionId: string,
  daysRemaining: number,
): string {
  return uuidV4FromSha256(
    TRIAL_REMINDER_ID_NAMESPACE,
    `${subscriptionId.trim()}:${daysRemaining}`,
  );
}

/**
 * UUID déterministe pour ticks GPS livreur (OPT-002).
 * Même agent + commande + position arrondie + fenêtre temporelle → idempotence domaine.
 */
export function domainEventIdFromCourierTracking(
  agentUserId: string,
  orderId: string,
  latitude: number,
  longitude: number,
  windowMs: number,
  coordPrecision = 4,
): string {
  const window = Math.floor(Date.now() / Math.max(1000, windowMs));
  const lat = roundCourierCoord(latitude, coordPrecision);
  const lng = roundCourierCoord(longitude, coordPrecision);
  return uuidV4FromSha256(
    COURIER_TRACKING_ID_NAMESPACE,
    `${agentUserId.trim()}:${orderId.trim()}:${lat}:${lng}:${window}`,
  );
}

function roundCourierCoord(value: number, precision: number): number {
  const factor = 10 ** Math.max(0, Math.min(8, precision));
  return Math.round(value * factor) / factor;
}
