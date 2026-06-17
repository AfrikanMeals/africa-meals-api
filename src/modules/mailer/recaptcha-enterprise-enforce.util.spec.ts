import { isRecaptchaEnterpriseEnforced } from './recaptcha-enterprise-enforce.util';

describe('recaptcha-enterprise-enforce.util', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.RECAPTCHA_ENTERPRISE_ENFORCE;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = env;
  });

  it('force en production par défaut', () => {
    process.env.NODE_ENV = 'production';
    expect(isRecaptchaEnterpriseEnforced()).toBe(true);
  });

  it('respecte RECAPTCHA_ENTERPRISE_ENFORCE=false en prod', () => {
    process.env.NODE_ENV = 'production';
    process.env.RECAPTCHA_ENTERPRISE_ENFORCE = 'false';
    expect(isRecaptchaEnterpriseEnforced()).toBe(false);
  });

  it('désactivé en dev par défaut', () => {
    process.env.NODE_ENV = 'development';
    expect(isRecaptchaEnterpriseEnforced()).toBe(false);
  });
});
