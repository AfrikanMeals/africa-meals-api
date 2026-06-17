/** Profils de rate limit pour routes auth sensibles (H-02). */
export type AuthRateLimitProfile =
  | 'login'
  | 'otp'
  | 'password'
  | 'refresh'
  | 'register';

export const AUTH_RATE_LIMIT_PROFILES: Record<
  AuthRateLimitProfile,
  { windowMs: number; maxRequests: number }
> = {
  login: { windowMs: 15 * 60_000, maxRequests: 15 },
  otp: { windowMs: 15 * 60_000, maxRequests: 10 },
  password: { windowMs: 60 * 60_000, maxRequests: 8 },
  refresh: { windowMs: 15 * 60_000, maxRequests: 40 },
  register: { windowMs: 60 * 60_000, maxRequests: 6 },
};

export function isAuthRateLimitEnabled(raw?: string): boolean {
  const v = String(raw ?? process.env.AUTH_RATE_LIMIT_ENABLED ?? 'true')
    .trim()
    .toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

export function authRateLimitKey(
  profile: AuthRateLimitProfile,
  ip: string,
  email?: string,
): string {
  const mail = email?.trim().toLowerCase() ?? '';
  return `${profile}:${ip}:${mail}`;
}
