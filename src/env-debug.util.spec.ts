import {
  isEnvDebugControllerEnabled,
  readEnvDebugBasicAuthCredentials,
  verifyEnvDebugBasicAuthHeader,
} from './env-debug.util';

describe('env-debug.util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ENABLE_ENV_DEBUG;
    delete process.env.ENV_DEBUG_BASIC_USER;
    delete process.env.ENV_DEBUG_BASIC_PASS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isEnvDebugControllerEnabled', () => {
    it('returns false in production regardless of ENABLE_ENV_DEBUG', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_ENV_DEBUG = 'true';
      expect(isEnvDebugControllerEnabled()).toBe(false);
    });

    it('returns false outside production when flag is absent', () => {
      process.env.NODE_ENV = 'development';
      expect(isEnvDebugControllerEnabled()).toBe(false);
    });

    it('returns true outside production when explicitly enabled', () => {
      process.env.NODE_ENV = 'local';
      process.env.ENABLE_ENV_DEBUG = 'true';
      expect(isEnvDebugControllerEnabled()).toBe(true);
    });
  });

  describe('readEnvDebugBasicAuthCredentials', () => {
    it('returns null when credentials are missing', () => {
      expect(readEnvDebugBasicAuthCredentials()).toBeNull();
    });

    it('returns trimmed credentials when configured', () => {
      process.env.ENV_DEBUG_BASIC_USER = ' diag ';
      process.env.ENV_DEBUG_BASIC_PASS = ' secret ';
      expect(readEnvDebugBasicAuthCredentials()).toEqual({
        user: 'diag',
        password: 'secret',
      });
    });
  });

  describe('verifyEnvDebugBasicAuthHeader', () => {
    it('accepts valid Basic credentials', () => {
      const header = `Basic ${Buffer.from('diag:secret').toString('base64')}`;
      expect(
        verifyEnvDebugBasicAuthHeader(header, 'diag', 'secret'),
      ).toBe(true);
    });

    it('rejects invalid credentials', () => {
      const header = `Basic ${Buffer.from('diag:wrong').toString('base64')}`;
      expect(
        verifyEnvDebugBasicAuthHeader(header, 'diag', 'secret'),
      ).toBe(false);
    });
  });
});
