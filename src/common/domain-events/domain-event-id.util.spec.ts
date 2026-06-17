import {
  domainEventIdFromCourierTracking,
  domainEventIdFromStripeWebhook,
  domainEventIdFromTrialReminder,
} from './domain-event-id.util';

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

describe('domainEventIdFromTrialReminder (EDA-009)', () => {
  it('returns a stable id for the same subscription and days remaining', () => {
    const a = domainEventIdFromTrialReminder('674a1b2c3d4e5f6789012345', 3);
    const b = domainEventIdFromTrialReminder('674a1b2c3d4e5f6789012345', 3);
    expect(a).toBe(b);
  });

  it('returns different ids for different days remaining', () => {
    const a = domainEventIdFromTrialReminder('674a1b2c3d4e5f6789012345', 3);
    const b = domainEventIdFromTrialReminder('674a1b2c3d4e5f6789012345', 1);
    expect(a).not.toBe(b);
  });
});

describe('domainEventIdFromCourierTracking (OPT-002)', () => {
  it('returns a stable id for the same agent, order and rounded coords', () => {
    const a = domainEventIdFromCourierTracking(
      'agent1',
      'order1',
      48.856611,
      2.352211,
      3000,
      4,
    );
    const b = domainEventIdFromCourierTracking(
      'agent1',
      'order1',
      48.856619,
      2.352219,
      3000,
      4,
    );
    expect(a).toBe(b);
  });

  it('returns different ids for different orders', () => {
    const a = domainEventIdFromCourierTracking(
      'agent1',
      'order1',
      48.8566,
      2.3522,
      3000,
      4,
    );
    const b = domainEventIdFromCourierTracking(
      'agent1',
      'order2',
      48.8566,
      2.3522,
      3000,
      4,
    );
    expect(a).not.toBe(b);
  });
});
