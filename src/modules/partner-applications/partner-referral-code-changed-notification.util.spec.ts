import {
  buildPartnerReferralCodeChangedNotificationCopy,
  PARTNER_REFERRAL_CODE_CHANGED_NOTIFICATION_TYPE,
} from './partner-referral-code-changed-notification.util';

describe('partner-referral-code-changed-notification.util', () => {
  it('remplacement : ancien + nouveau dans le corps', () => {
    const copy = buildPartnerReferralCodeChangedNotificationCopy({
      referralCode: 'code01',
      previousReferralCode: 'ab23cd',
    });
    expect(copy.type).toBe(PARTNER_REFERRAL_CODE_CHANGED_NOTIFICATION_TYPE);
    expect(copy.title).toMatch(/mis à jour/i);
    expect(copy.body).toContain('CODE01');
    expect(copy.body).toContain('AB23CD');
  });

  it('première attribution : pas d’ancien code', () => {
    const copy = buildPartnerReferralCodeChangedNotificationCopy({
      referralCode: 'XY2Z3W',
      previousReferralCode: null,
    });
    expect(copy.title).toMatch(/défini/i);
    expect(copy.body).toContain('XY2Z3W');
    expect(copy.body).not.toMatch(/ancien/i);
  });
});
