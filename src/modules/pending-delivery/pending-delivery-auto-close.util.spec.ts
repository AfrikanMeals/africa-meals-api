import { describe, expect, it } from '@jest/globals';
import { PendingDeliveryProofStatusEnum } from '@schemas/pending-delivery-proof.schema';
import {
  isPendingDeliveryAutoCloseEligible,
  pendingDeliveryAutoCloseDaysFromEnv,
} from './pending-delivery-auto-close.util';

describe('pending-delivery-auto-close.util', () => {
  it('pendingDeliveryAutoCloseDaysFromEnv defaults to 7', () => {
    expect(pendingDeliveryAutoCloseDaysFromEnv(undefined)).toBe(7);
    expect(pendingDeliveryAutoCloseDaysFromEnv('')).toBe(7);
    expect(pendingDeliveryAutoCloseDaysFromEnv('abc')).toBe(7);
  });

  it('pendingDeliveryAutoCloseDaysFromEnv parses positive integers', () => {
    expect(pendingDeliveryAutoCloseDaysFromEnv('14')).toBe(14);
    expect(pendingDeliveryAutoCloseDaysFromEnv('0')).toBe(7);
  });

  it('isPendingDeliveryAutoCloseEligible only for submitted proofs past cutoff', () => {
    const now = new Date('2026-07-08T12:00:00.000Z');
    const oldEnough = new Date('2026-06-30T12:00:00.000Z');
    const tooRecent = new Date('2026-07-07T12:00:00.000Z');

    expect(
      isPendingDeliveryAutoCloseEligible({
        status: PendingDeliveryProofStatusEnum.SUBMITTED,
        createdAt: oldEnough,
        now,
        autoCloseDays: 7,
      }),
    ).toBe(true);

    expect(
      isPendingDeliveryAutoCloseEligible({
        status: PendingDeliveryProofStatusEnum.SUBMITTED,
        createdAt: tooRecent,
        now,
        autoCloseDays: 7,
      }),
    ).toBe(false);

    expect(
      isPendingDeliveryAutoCloseEligible({
        status: PendingDeliveryProofStatusEnum.CUSTOMER_CONFIRMED,
        createdAt: oldEnough,
        now,
        autoCloseDays: 7,
      }),
    ).toBe(false);
  });
});
