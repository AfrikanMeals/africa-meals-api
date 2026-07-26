import { mapSignupRoleToUserType } from './signup-role-to-user-type.util';
import { UserTypeEnum } from '@schemas/user.schema';

describe('mapSignupRoleToUserType', () => {
  it('mappe restaurant → VENDOR, livreur → DELIVERY, partenaire → PARTNER', () => {
    expect(mapSignupRoleToUserType('restaurant')).toBe(UserTypeEnum.VENDOR);
    expect(mapSignupRoleToUserType('livreur')).toBe(UserTypeEnum.DELIVERY);
    expect(mapSignupRoleToUserType('partenaire')).toBe(UserTypeEnum.PARTNER);
  });

  it('client / vide / inconnu → USER', () => {
    expect(mapSignupRoleToUserType('client')).toBe(UserTypeEnum.USER);
    expect(mapSignupRoleToUserType('')).toBe(UserTypeEnum.USER);
    expect(mapSignupRoleToUserType(undefined)).toBe(UserTypeEnum.USER);
    expect(mapSignupRoleToUserType('admin')).toBe(UserTypeEnum.USER);
  });
});
