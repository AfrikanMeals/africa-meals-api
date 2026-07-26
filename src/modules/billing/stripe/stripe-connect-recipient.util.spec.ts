import { UserTypeEnum } from '@schemas/user.schema';
import { isStripeConnectRecipientType } from './stripe-connect-recipient.util';

describe('isStripeConnectRecipientType', () => {
  it('autorise VENDOR, DELIVERY, PARTNER', () => {
    expect(isStripeConnectRecipientType(UserTypeEnum.VENDOR)).toBe(true);
    expect(isStripeConnectRecipientType(UserTypeEnum.DELIVERY)).toBe(true);
    expect(isStripeConnectRecipientType(UserTypeEnum.PARTNER)).toBe(true);
    expect(isStripeConnectRecipientType('partner')).toBe(true);
  });

  it('refuse USER / ADMIN / vide', () => {
    expect(isStripeConnectRecipientType(UserTypeEnum.USER)).toBe(false);
    expect(isStripeConnectRecipientType(UserTypeEnum.ADMIN)).toBe(false);
    expect(isStripeConnectRecipientType('')).toBe(false);
    expect(isStripeConnectRecipientType(null)).toBe(false);
  });
});
