import { UserTypeEnum } from '@schemas/user.schema';
import {
  canAccessDeliveryConnectPayments,
  canSettleDeliveryConnectPayout,
} from './stripe-connect-dual-role.util';

describe('canAccessDeliveryConnectPayments', () => {
  it('autorise type DELIVERY sans regarder la candidature', () => {
    expect(
      canAccessDeliveryConnectPayments({ userType: UserTypeEnum.DELIVERY }),
    ).toBe(true);
  });

  it('autorise PARTNER / VENDOR dual-role si candidature APPROVED', () => {
    expect(
      canAccessDeliveryConnectPayments({
        userType: UserTypeEnum.PARTNER,
        deliveryApplicationStatus: 'APPROVED',
      }),
    ).toBe(true);
    expect(
      canAccessDeliveryConnectPayments({
        userType: UserTypeEnum.VENDOR,
        deliveryApplicationStatus: 'approved',
      }),
    ).toBe(true);
  });

  it('refuse PARTNER sans candidature livreur APPROVED', () => {
    expect(
      canAccessDeliveryConnectPayments({
        userType: UserTypeEnum.PARTNER,
        deliveryApplicationStatus: 'PENDING',
      }),
    ).toBe(false);
    expect(
      canAccessDeliveryConnectPayments({ userType: UserTypeEnum.PARTNER }),
    ).toBe(false);
  });

  it('refuse ADMIN', () => {
    expect(
      canAccessDeliveryConnectPayments({
        userType: UserTypeEnum.ADMIN,
        deliveryApplicationStatus: 'APPROVED',
      }),
    ).toBe(false);
  });
});

describe('canSettleDeliveryConnectPayout', () => {
  it('autorise VENDOR / DELIVERY / PARTNER (même Connect)', () => {
    expect(canSettleDeliveryConnectPayout(UserTypeEnum.DELIVERY)).toBe(true);
    expect(canSettleDeliveryConnectPayout(UserTypeEnum.PARTNER)).toBe(true);
    expect(canSettleDeliveryConnectPayout(UserTypeEnum.VENDOR)).toBe(true);
  });

  it('refuse USER / ADMIN', () => {
    expect(canSettleDeliveryConnectPayout(UserTypeEnum.USER)).toBe(false);
    expect(canSettleDeliveryConnectPayout(UserTypeEnum.ADMIN)).toBe(false);
  });
});
