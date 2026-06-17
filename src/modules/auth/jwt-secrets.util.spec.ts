import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assertJwtRefreshSecretsOnBoot,
  resolveRefreshTokenSecret,
} from './jwt-secrets.util';

describe('jwt-secrets.util', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = env;
  });

  function config(values: Record<string, string | undefined>): ConfigService {
    return {
      get: (key: string) => values[key],
    } as ConfigService;
  }

  it('refuse le fallback refresh=access en production', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      resolveRefreshTokenSecret(
        config({ JWT_SECRET: 'same', JWT_REFRESH_SECRET: undefined }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('refuse refresh identique à access en production', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      resolveRefreshTokenSecret(
        config({ JWT_SECRET: 'secret', JWT_REFRESH_SECRET: 'secret' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('autorise le fallback en dev', () => {
    process.env.NODE_ENV = 'development';
    expect(
      resolveRefreshTokenSecret(
        config({ JWT_SECRET: 'dev-access', JWT_REFRESH_SECRET: undefined }),
      ),
    ).toBe('dev-access');
  });

  it('échoue au boot si refresh absent en prod', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertJwtRefreshSecretsOnBoot(
        config({ JWT_SECRET: 'a', JWT_REFRESH_SECRET: '' }),
      ),
    ).toThrow(/JWT_REFRESH_SECRET is required/);
  });
});
