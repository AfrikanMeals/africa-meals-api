import {
  buildConnectTransferIdempotencyKey,
  isStripeIdempotencyMismatchError,
} from './stripe-connect-transfer-idempotency.util';

describe('stripe-connect-transfer-idempotency.util', () => {
  describe('buildConnectTransferIdempotencyKey', () => {
    it('embeds kind, orderId, amount and truncated ids', () => {
      const key = buildConnectTransferIdempotencyKey({
        kind: 'delivery',
        orderId: '6a44a5a43113cbc48ab0cfca',
        amountCents: 1250,
        destination: 'acct_1ABCDEFghijklmnopq',
        chargeId: 'ch_3XYZ0123456789abcdef',
      });
      expect(key).toContain('tr-delivery-');
      expect(key).toContain('6a44a5a43113cbc48ab0cfca');
      expect(key).toContain('-1250-');
      expect(key.length).toBeLessThanOrEqual(255);
    });

    it('changes when amount or destination changes', () => {
      const base = {
        kind: 'delivery' as const,
        orderId: '6a44a5a43113cbc48ab0cfca',
        amountCents: 1000,
        destination: 'acct_AAA',
        chargeId: 'ch_111',
      };
      const a = buildConnectTransferIdempotencyKey(base);
      const b = buildConnectTransferIdempotencyKey({
        ...base,
        amountCents: 999,
      });
      const c = buildConnectTransferIdempotencyKey({
        ...base,
        destination: 'acct_BBB',
      });
      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
    });

    it('is stable for identical params', () => {
      const args = {
        kind: 'delivery-tip' as const,
        orderId: 'abc',
        amountCents: 200,
        destination: 'acct_1',
        chargeId: 'ch_1',
      };
      expect(buildConnectTransferIdempotencyKey(args)).toBe(
        buildConnectTransferIdempotencyKey(args),
      );
    });
  });

  describe('isStripeIdempotencyMismatchError', () => {
    it('detects Stripe idempotency_error type', () => {
      expect(
        isStripeIdempotencyMismatchError({
          type: 'idempotency_error',
          message: 'Keys for idempotent requests can only be used with the same parameters they were first used with.',
        }),
      ).toBe(true);
    });

    it('detects message-only mismatch', () => {
      expect(
        isStripeIdempotencyMismatchError(
          new Error(
            'Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than X',
          ),
        ),
      ).toBe(true);
    });

    it('ignores unrelated errors', () => {
      expect(
        isStripeIdempotencyMismatchError(new Error('insufficient funds')),
      ).toBe(false);
      expect(isStripeIdempotencyMismatchError(null)).toBe(false);
    });
  });
});
