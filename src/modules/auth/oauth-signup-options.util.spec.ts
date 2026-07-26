import { UserTypeEnum } from '@schemas/user.schema';
import { resolveOauthNewUserType } from './oauth-signup-options.util';

describe('resolveOauthNewUserType', () => {
  it('garde le défaut sans signupRole', () => {
    expect(resolveOauthNewUserType(UserTypeEnum.USER, undefined)).toBe(
      UserTypeEnum.USER,
    );
    expect(resolveOauthNewUserType(UserTypeEnum.VENDOR, null)).toBe(
      UserTypeEnum.VENDOR,
    );
  });

  it('mappe restaurant / livreur / partenaire / client', () => {
    expect(resolveOauthNewUserType(UserTypeEnum.USER, 'restaurant')).toBe(
      UserTypeEnum.VENDOR,
    );
    expect(resolveOauthNewUserType(UserTypeEnum.USER, 'livreur')).toBe(
      UserTypeEnum.DELIVERY,
    );
    expect(resolveOauthNewUserType(UserTypeEnum.USER, 'partenaire')).toBe(
      UserTypeEnum.PARTNER,
    );
    expect(resolveOauthNewUserType(UserTypeEnum.VENDOR, 'client')).toBe(
      UserTypeEnum.USER,
    );
  });
});
