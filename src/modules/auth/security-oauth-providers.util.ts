export type SecurityOauthProvider = 'google' | 'apple' | 'facebook';

export type SecurityOauthIds = {
  googleId?: string | null;
  appleId?: string | null;
  facebookId?: string | null;
};

/**
 * Dérive les providers OAuth liés pour GET /auth/me/security.
 * Ordre stable : google → apple → facebook (icônes UI mobile).
 */
export function deriveSecurityOauthProviders(
  ids: SecurityOauthIds,
): SecurityOauthProvider[] {
  const out: SecurityOauthProvider[] = [];
  if (typeof ids.googleId === 'string' && ids.googleId.trim()) {
    out.push('google');
  }
  if (typeof ids.appleId === 'string' && ids.appleId.trim()) {
    out.push('apple');
  }
  if (typeof ids.facebookId === 'string' && ids.facebookId.trim()) {
    out.push('facebook');
  }
  return out;
}
