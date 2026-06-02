import { phoneToSmsE164, readTwilioSmsConfig } from './twilio-sms.util';

describe('twilio-sms.util', () => {
  it('lit la config avec Messaging Service', () => {
    const cfg = readTwilioSmsConfig({
      TWILIO_ACCOUNT_SID: 'ACtest',
      TWILIO_AUTH_TOKEN: 'secret',
      TWILIO_SERVICE_ID: 'MGabc',
    });
    expect(cfg?.messagingServiceSid).toBe('MGabc');
    expect(cfg?.from).toBeUndefined();
  });

  it('lit la config avec numéro From', () => {
    const cfg = readTwilioSmsConfig({
      TWILIO_ACCOUNT_SID: 'ACtest',
      TWILIO_AUTH_TOKEN: 'secret',
      TWILIO_PHONE_NUMBER: '+15551234',
    });
    expect(cfg?.from).toBe('+15551234');
  });

  it('convertit un numéro 10 chiffres', () => {
    expect(phoneToSmsE164('5145551234', '1')).toBe('+15145551234');
  });
});
