import { UserTypeEnum } from '@schemas/user.schema';

/** Valeurs du sélecteur inscription Dashboard (alignées RegisterDto.signupRole). */
export const SIGNUP_ROLE_VALUES = [
  'restaurant',
  'livreur',
  'partenaire',
  'client',
] as const;

export type SignupRoleValue = (typeof SIGNUP_ROLE_VALUES)[number];

/**
 * Mappe le rôle UI d’inscription vers `UserTypeEnum`.
 * Défaut / inconnu → USER (client).
 */
export function mapSignupRoleToUserType(
  role?: string | null,
): UserTypeEnum {
  switch (String(role ?? '').trim().toLowerCase()) {
    case 'restaurant':
      return UserTypeEnum.VENDOR;
    case 'livreur':
      return UserTypeEnum.DELIVERY;
    case 'partenaire':
      return UserTypeEnum.PARTNER;
    case 'client':
    default:
      return UserTypeEnum.USER;
  }
}
