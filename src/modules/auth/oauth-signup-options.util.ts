import { UserTypeEnum } from '@schemas/user.schema';
import { mapSignupRoleToUserType } from './signup-role-to-user-type.util';

/**
 * Type à la création OAuth : `signupRole` (landing / mobile) prime sur le défaut
 * du endpoint (USER mobile, VENDOR admin). Login existant : inchangé.
 */
export function resolveOauthNewUserType(
  defaultTypeForNewUser: UserTypeEnum,
  signupRole?: string | null,
): UserTypeEnum {
  const role = String(signupRole ?? '').trim();
  if (!role) return defaultTypeForNewUser;
  return mapSignupRoleToUserType(role);
}
