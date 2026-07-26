import {
  buildPartnerProfileReviewNotificationCopy,
  PARTNER_PROFILE_REVIEW_NOTIFICATION_TYPE,
} from './partner-profile-review-notification.util';

describe('partner-profile-review-notification.util', () => {
  it('APPROVED sans motif', () => {
    const c = buildPartnerProfileReviewNotificationCopy({ status: 'APPROVED' });
    expect(c.title).toMatch(/approuvée/i);
    expect(c.body.length).toBeGreaterThan(10);
  });

  it('APPROVED inclut le code de parrainage', () => {
    const c = buildPartnerProfileReviewNotificationCopy({
      status: 'APPROVED',
      referralCode: 'ab34xy',
    });
    expect(c.body).toContain('AB34XY');
    expect(c.body).toMatch(/parrainage/i);
  });

  it('REJECTED inclut le motif', () => {
    const c = buildPartnerProfileReviewNotificationCopy({
      status: 'REJECTED',
      rejectionReason: 'Infos incomplètes',
    });
    expect(c.body).toContain('Infos incomplètes');
  });

  it('SUSPENDED / REACTIVATED distincts', () => {
    const s = buildPartnerProfileReviewNotificationCopy({
      status: 'SUSPENDED',
    });
    const r = buildPartnerProfileReviewNotificationCopy({
      status: 'REACTIVATED',
    });
    expect(s.title).not.toEqual(r.title);
  });

  it('type canonique stable', () => {
    expect(PARTNER_PROFILE_REVIEW_NOTIFICATION_TYPE).toBe(
      'partner_profile_review',
    );
  });
});
