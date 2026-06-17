import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isProductionNodeEnv } from './jwt-token.util';

/** Vérifie les secrets JWT au démarrage en production (M-08). */
export function assertJwtRefreshSecretsOnBoot(config: ConfigService): void {
  if (!isProductionNodeEnv()) {
    return;
  }
  const access = config.get<string>('JWT_SECRET')?.trim() ?? '';
  const refresh = config.get<string>('JWT_REFRESH_SECRET')?.trim() ?? '';
  if (!refresh) {
    throw new Error(
      'JWT_REFRESH_SECRET is required in production (distinct from JWT_SECRET)',
    );
  }
  if (refresh === access) {
    throw new Error('JWT_REFRESH_SECRET must differ from JWT_SECRET in production');
  }
}

export function resolveRefreshTokenSecret(config: ConfigService): string {
  const explicit = config.get<string>('JWT_REFRESH_SECRET')?.trim() ?? '';
  const accessSecret = config.get<string>('JWT_SECRET')?.trim() ?? '';

  if (isProductionNodeEnv()) {
    if (!explicit) {
      throw new UnauthorizedException('jwt_refresh_secret_not_configured');
    }
    if (explicit === accessSecret) {
      throw new UnauthorizedException('jwt_refresh_secret_must_differ');
    }
    return explicit;
  }

  if (explicit) {
    return explicit;
  }
  if (accessSecret) {
    return accessSecret;
  }
  throw new UnauthorizedException('jwt_secret_not_configured');
}
