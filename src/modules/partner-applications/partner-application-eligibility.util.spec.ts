import { UserTypeEnum } from '@schemas/user.schema';
import {
  isEligibleForPartnerApplication,
  resolvePartnerSuspendRestoreType,
} from './partner-application-eligibility.util';

describe('partner-application-eligibility.util', () => {
  it('autorise USER / VENDOR / DELIVERY', () => {
    expect(isEligibleForPartnerApplication(UserTypeEnum.USER)).toBe(true);
    expect(isEligibleForPartnerApplication(UserTypeEnum.VENDOR)).toBe(true);
    expect(isEligibleForPartnerApplication(UserTypeEnum.DELIVERY)).toBe(true);
    expect(isEligibleForPartnerApplication('user')).toBe(true);
  });

  it('refuse ADMIN / PARTNER / vide', () => {
    expect(isEligibleForPartnerApplication(UserTypeEnum.ADMIN)).toBe(false);
    expect(isEligibleForPartnerApplication(UserTypeEnum.PARTNER)).toBe(false);
    expect(isEligibleForPartnerApplication('')).toBe(false);
    expect(isEligibleForPartnerApplication(null)).toBe(false);
  });

  it('restaure le type précédent à la suspension', () => {
    expect(resolvePartnerSuspendRestoreType(UserTypeEnum.VENDOR)).toBe(
      UserTypeEnum.VENDOR,
    );
    expect(resolvePartnerSuspendRestoreType(UserTypeEnum.DELIVERY)).toBe(
      UserTypeEnum.DELIVERY,
    );
    expect(resolvePartnerSuspendRestoreType(UserTypeEnum.USER)).toBe(
      UserTypeEnum.USER,
    );
    expect(resolvePartnerSuspendRestoreType(null)).toBe(UserTypeEnum.USER);
    expect(resolvePartnerSuspendRestoreType('PARTNER')).toBe(UserTypeEnum.USER);
  });
});
