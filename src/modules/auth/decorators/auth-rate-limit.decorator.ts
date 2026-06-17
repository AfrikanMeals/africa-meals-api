import { SetMetadata } from '@nestjs/common';
import type { AuthRateLimitProfile } from '../auth-rate-limit.util';

export const AUTH_RATE_LIMIT_KEY = 'auth_rate_limit_profile';

export const AuthRateLimit = (profile: AuthRateLimitProfile) =>
  SetMetadata(AUTH_RATE_LIMIT_KEY, profile);
