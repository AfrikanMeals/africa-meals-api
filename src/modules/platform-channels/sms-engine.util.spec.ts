import {
  buildSmsEngineOptions,
  normalizeSmsEngine,
  SMS_ENGINE_AUTO,
  SMS_ENGINE_BIRD,
  SMS_ENGINE_TWILIO,
} from './sms-engine.util';

describe('sms-engine.util', () => {
  it('normalizeSmsEngine defaults to bird', () => {
    expect(normalizeSmsEngine(undefined)).toBe(SMS_ENGINE_BIRD);
    expect(normalizeSmsEngine('twilio')).toBe(SMS_ENGINE_TWILIO);
    expect(normalizeSmsEngine('auto')).toBe(SMS_ENGINE_AUTO);
  });

  it('buildSmsEngineOptions marks configured engines', () => {
    const options = buildSmsEngineOptions({
      birdConfigured: true,
      twilioConfigured: false,
    });
    expect(options.find((o) => o.value === SMS_ENGINE_BIRD)?.configured).toBe(true);
    expect(options.find((o) => o.value === SMS_ENGINE_TWILIO)?.configured).toBe(false);
    expect(options.find((o) => o.value === SMS_ENGINE_AUTO)?.configured).toBe(true);
  });
});
