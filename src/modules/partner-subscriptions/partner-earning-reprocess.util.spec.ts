import {
  accumulatePartnerEarningReprocessOutcome,
  classifyPartnerEarningReprocessOutcome,
  emptyPartnerEarningReprocessCounters,
  isPartnerEarningFailedStatus,
  partnerEarningTransferIdempotencyKey,
} from './partner-earning-reprocess.util';

describe('partner-earning-reprocess.util', () => {
  it('idempotency key stable', () => {
    expect(partnerEarningTransferIdempotencyKey('abc123')).toBe(
      'partner_aff_earning_abc123',
    );
    expect(partnerEarningTransferIdempotencyKey('abc123', 'cad')).toBe(
      'partner_aff_earning_abc123_cad',
    );
  });

  it('détecte FAILED', () => {
    expect(isPartnerEarningFailedStatus('FAILED')).toBe(true);
    expect(isPartnerEarningFailedStatus('failed')).toBe(true);
    expect(isPartnerEarningFailedStatus('PENDING')).toBe(false);
  });

  it('classifie outcomes', () => {
    expect(
      classifyPartnerEarningReprocessOutcome({
        afterStatus: 'TRANSFERRED',
        hadConnectAccount: true,
      }),
    ).toBe('transferred');
    expect(
      classifyPartnerEarningReprocessOutcome({
        afterStatus: 'FAILED',
        hadConnectAccount: true,
      }),
    ).toBe('still_failed');
    expect(
      classifyPartnerEarningReprocessOutcome({
        afterStatus: 'PENDING',
        hadConnectAccount: false,
      }),
    ).toBe('skipped');
  });

  it('accumule compteurs', () => {
    let c = emptyPartnerEarningReprocessCounters();
    c = accumulatePartnerEarningReprocessOutcome(c, 'transferred');
    c = accumulatePartnerEarningReprocessOutcome(c, 'still_failed');
    c = accumulatePartnerEarningReprocessOutcome(c, 'skipped');
    expect(c).toEqual({
      attempted: 3,
      transferred: 1,
      stillFailed: 1,
      skipped: 1,
    });
  });
});
