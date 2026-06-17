import { domainEventIdFromStripeWebhook } from './domain-event-id.util';

describe('domainEventIdFromStripeWebhook', () => {
  it('returns a stable UUID v4-compatible id for the same Stripe event', () => {
    const a = domainEventIdFromStripeWebhook('evt_1ABC123');
    const b = domainEventIdFromStripeWebhook('evt_1ABC123');
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('returns different ids for different Stripe events', () => {
    const a = domainEventIdFromStripeWebhook('evt_1ABC123');
    const b = domainEventIdFromStripeWebhook('evt_1XYZ789');
    expect(a).not.toBe(b);
  });
});
